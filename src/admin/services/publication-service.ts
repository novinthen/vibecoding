import type { Db } from '@/db/client';
import { AdminAuditLogRepository, PublicationRepository } from '@/domain';
import type { PublicationStatus } from '@/domain/enums';
import { slugify } from '@/domain/slug';
import type { PublicationDomainRow, PublicationRow } from '@/domain/types';

import { assertCanMutate } from '../auth/guard';
import type { AdminSession } from '../auth/session';
import { AdminValidationError, NotFoundError } from '../errors';
import {
  addDomainSchema,
  createPublicationSchema,
  setPublicationStatusSchema,
  updatePublicationSchema,
} from '../validation';

import { auditDomainView, auditPublicationView } from './audit-view';

/**
 * Publication administration service (Stage 5B).
 *
 * Manages Publications (editorial brands) and their domains. Every mutation:
 * (1) enforces authorization server-side, (2) validates untrusted input,
 * (3) writes through the repository, and (4) records an AdminAuditLog entry —
 * within the caller's transaction so mutation and audit commit together.
 *
 * These rows only carry publication-specific configuration and hostname
 * mapping; canonical intelligence (Article/Story) stays global and is never
 * touched here. Branding/SEO/editorial-profile edits MERGE into the existing
 * JSONB so unknown keys and future config are preserved (no silent overwrite).
 */

/** Apply `{key: value|null}` updates onto an existing JSONB config object. */
function mergeConfig(
  existing: Record<string, unknown>,
  updates: Record<string, string | null | undefined>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      delete next[key];
    } else if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

export async function createPublication(
  db: Db,
  actor: AdminSession,
  input: unknown,
): Promise<PublicationRow> {
  assertCanMutate(actor);
  const values = createPublicationSchema.parse(input);
  const slug = values.slug ?? slugify(values.name);
  if (slug.length === 0) {
    throw new AdminValidationError(
      'slug',
      'Could not derive a slug from the name.',
    );
  }

  const publications = new PublicationRepository(db);
  if (await publications.findBySlug(slug)) {
    throw new AdminValidationError(
      'slug',
      `A Publication with slug "${slug}" already exists.`,
    );
  }

  const created = await publications.create({
    name: values.name,
    slug,
    defaultLocale: values.defaultLocale,
    timezone: values.timezone,
    branding: mergeConfig(
      {},
      { name: values.brandingName, tagline: values.tagline },
    ),
    seoSettings: mergeConfig({}, { description: values.seoDescription }),
    editorialProfile: mergeConfig(
      {},
      { positioning: values.positioning, audience: values.audience },
    ),
  });

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_CREATE',
    actorIdentifier: actor.username,
    targetType: 'publication',
    targetId: created.id,
    after: auditPublicationView(created),
    metadata: { role: actor.role },
  });
  return created;
}

export async function updatePublication(
  db: Db,
  actor: AdminSession,
  id: string,
  input: unknown,
): Promise<PublicationRow> {
  assertCanMutate(actor);
  const values = updatePublicationSchema.parse(input);
  const publications = new PublicationRepository(db);
  const before = await publications.findById(id);
  if (!before) throw new NotFoundError('Publication not found.');

  const updated = await publications.update(id, {
    name: values.name,
    defaultLocale: values.defaultLocale,
    timezone: values.timezone,
    branding: mergeConfig(before.branding, {
      name: values.brandingName,
      tagline: values.tagline,
    }),
    seoSettings: mergeConfig(before.seo_settings, {
      description: values.seoDescription,
    }),
    editorialProfile: mergeConfig(before.editorial_profile, {
      positioning: values.positioning,
      audience: values.audience,
    }),
  });
  if (!updated) throw new NotFoundError('Publication not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_UPDATE',
    actorIdentifier: actor.username,
    targetType: 'publication',
    targetId: id,
    before: auditPublicationView(before),
    after: auditPublicationView(updated),
    metadata: { role: actor.role },
  });
  return updated;
}

export async function setPublicationStatus(
  db: Db,
  actor: AdminSession,
  id: string,
  input: unknown,
): Promise<PublicationRow> {
  assertCanMutate(actor);
  const { status } = setPublicationStatusSchema.parse(input);
  const publications = new PublicationRepository(db);
  const before = await publications.findById(id);
  if (!before) throw new NotFoundError('Publication not found.');

  // Invariant: an ACTIVE Publication must have exactly one ENABLED primary
  // domain (it is the resolvable public host). Refuse to activate without one.
  if (status === 'ACTIVE') {
    const primary = await publications.findEnabledPrimaryDomain(id);
    if (!primary) {
      throw new AdminValidationError(
        'status',
        'An ACTIVE Publication must have an enabled primary domain. Add or ' +
          'enable a domain and set it primary before activating.',
      );
    }
  }

  const updated = await publications.setStatus(id, status as PublicationStatus);
  if (!updated) throw new NotFoundError('Publication not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_STATUS_CHANGE',
    actorIdentifier: actor.username,
    targetType: 'publication',
    targetId: id,
    before: { status: before.status },
    after: { status: updated.status },
    metadata: { role: actor.role, from: before.status, to: updated.status },
  });
  return updated;
}

// --- Domains ---------------------------------------------------------------
//
// PublicationDomain lifecycle invariants (kept atomically inside the caller's
// transaction):
//
//   I1. No DISABLED domain is ever primary.
//   I2. At most one primary domain per Publication (DB partial unique index).
//   I3. An ACTIVE Publication with at least one enabled domain has exactly one
//       ENABLED primary domain.
//
// Editorial behaviour for losing the current primary (disable/remove): a
// deterministic replacement (the oldest remaining ENABLED domain) is promoted
// automatically. If there is no enabled replacement AND the Publication is
// ACTIVE, the mutation is refused (deactivate first). A non-ACTIVE/DRAFT
// Publication may be left with no primary (I3 only binds ACTIVE Publications).

export async function addPublicationDomain(
  db: Db,
  actor: AdminSession,
  publicationId: string,
  input: unknown,
): Promise<PublicationDomainRow> {
  assertCanMutate(actor);
  const values = addDomainSchema.parse(input);
  const publications = new PublicationRepository(db);
  const publication = await publications.findById(publicationId);
  if (!publication) throw new NotFoundError('Publication not found.');

  // Domains are globally unique — surface a friendly error rather than a raw
  // unique-violation, whether the host is claimed by this or another Publication.
  const existing = await publications.findDomainByHost(values.domain);
  if (existing) {
    throw new AdminValidationError(
      'domain',
      `The domain "${values.domain}" is already registered.`,
    );
  }

  // The FIRST domain of a Publication becomes primary automatically, regardless
  // of the (omitted) checkbox, so a Publication never has domains without a
  // primary. A later domain is primary only when explicitly requested — and then
  // it must atomically replace the existing primary (I2), so clear it first.
  const currentDomains = await publications.listDomains(publicationId);
  const isFirst = currentDomains.length === 0;
  const isPrimary = isFirst || values.isPrimary;
  if (isPrimary && !isFirst) {
    for (const d of currentDomains) {
      if (d.is_primary) await publications.clearDomainPrimary(d.id);
    }
  }

  const created = await publications.addDomain({
    publicationId,
    domain: values.domain,
    isPrimary,
    enabled: true,
  });

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_DOMAIN_ADD',
    actorIdentifier: actor.username,
    targetType: 'publication_domain',
    targetId: created.id,
    after: auditDomainView(created),
    metadata: {
      role: actor.role,
      publication_id: publicationId,
      auto_primary: isFirst,
    },
  });
  return created;
}

/** Resolve a domain and assert it belongs to the given Publication. */
async function requireDomainOfPublication(
  publications: PublicationRepository,
  publicationId: string,
  domainId: string,
): Promise<PublicationDomainRow> {
  const domain = await publications.findDomainById(domainId);
  if (!domain || domain.publication_id !== publicationId) {
    throw new NotFoundError('Domain not found for this Publication.');
  }
  return domain;
}

/**
 * When the current primary is about to be disabled or removed, promote a
 * deterministic replacement (oldest enabled domain) so an ACTIVE Publication
 * keeps exactly one enabled primary. Records the auto-promotion audit. Throws
 * when no enabled replacement exists and the Publication is ACTIVE. Returns the
 * promoted domain id, or null when there was nothing to promote.
 */
async function promoteReplacementPrimary(
  db: Db,
  actor: AdminSession,
  publication: PublicationRow,
  domainId: string,
  reason: string,
): Promise<string | null> {
  const publications = new PublicationRepository(db);
  const replacement = await publications.findReplacementEnabledDomain(
    publication.id,
    domainId,
  );
  if (!replacement) {
    if (publication.status === 'ACTIVE') {
      throw new AdminValidationError(
        'domainId',
        'This is the only enabled domain of an ACTIVE Publication and is its ' +
          'primary. Add or enable another domain, or deactivate the ' +
          'Publication, before disabling or removing it.',
      );
    }
    return null;
  }
  await publications.setPrimaryDomain(replacement.id, publication.id);
  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_DOMAIN_SET_PRIMARY',
    actorIdentifier: actor.username,
    targetType: 'publication_domain',
    targetId: replacement.id,
    after: auditDomainView({ ...replacement, is_primary: true }),
    metadata: {
      role: actor.role,
      publication_id: publication.id,
      auto: true,
      reason,
    },
  });
  return replacement.id;
}

export async function setPublicationDomainEnabled(
  db: Db,
  actor: AdminSession,
  publicationId: string,
  domainId: string,
  enabled: boolean,
): Promise<PublicationDomainRow> {
  assertCanMutate(actor);
  const publications = new PublicationRepository(db);
  const publication = await publications.findById(publicationId);
  if (!publication) throw new NotFoundError('Publication not found.');
  const before = await requireDomainOfPublication(
    publications,
    publicationId,
    domainId,
  );

  if (!enabled && before.is_primary) {
    // Disabling the primary: promote a replacement (or refuse for ACTIVE with
    // no replacement). A disabled domain must never stay primary (I1), so clear
    // its flag whether or not a replacement was promoted.
    await promoteReplacementPrimary(
      db,
      actor,
      publication,
      domainId,
      'primary_disabled',
    );
    await publications.clearDomainPrimary(domainId);
  }

  const updated = await publications.setDomainEnabled(domainId, enabled);
  if (!updated) throw new NotFoundError('Domain not found.');

  // Enabling a domain when the Publication currently has no enabled primary
  // (e.g. a DRAFT that lost its primary) makes this one primary, so the
  // Publication is immediately activatable again.
  let finalRow = updated;
  if (enabled) {
    const primary = await publications.findEnabledPrimaryDomain(publicationId);
    if (!primary) {
      const promoted = await publications.setPrimaryDomain(
        domainId,
        publicationId,
      );
      if (promoted) finalRow = promoted;
    }
  }

  await new AdminAuditLogRepository(db).record({
    action: enabled
      ? 'PUBLICATION_DOMAIN_ENABLE'
      : 'PUBLICATION_DOMAIN_DISABLE',
    actorIdentifier: actor.username,
    targetType: 'publication_domain',
    targetId: domainId,
    before: { enabled: before.enabled, is_primary: before.is_primary },
    after: { enabled: finalRow.enabled, is_primary: finalRow.is_primary },
    metadata: { role: actor.role, publication_id: publicationId },
  });
  return finalRow;
}

export async function setPrimaryPublicationDomain(
  db: Db,
  actor: AdminSession,
  publicationId: string,
  domainId: string,
): Promise<PublicationDomainRow> {
  assertCanMutate(actor);
  const publications = new PublicationRepository(db);
  const publication = await publications.findById(publicationId);
  if (!publication) throw new NotFoundError('Publication not found.');
  const domain = await requireDomainOfPublication(
    publications,
    publicationId,
    domainId,
  );

  // A disabled domain must not become primary (I1) — it is not resolvable.
  if (!domain.enabled) {
    throw new AdminValidationError(
      'domainId',
      'A disabled domain cannot be made primary. Enable it first.',
    );
  }

  const updated = await publications.setPrimaryDomain(domainId, publicationId);
  if (!updated) throw new NotFoundError('Domain not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_DOMAIN_SET_PRIMARY',
    actorIdentifier: actor.username,
    targetType: 'publication_domain',
    targetId: domainId,
    after: auditDomainView(updated),
    metadata: { role: actor.role, publication_id: publicationId },
  });
  return updated;
}

export async function removePublicationDomain(
  db: Db,
  actor: AdminSession,
  publicationId: string,
  domainId: string,
): Promise<void> {
  assertCanMutate(actor);
  const publications = new PublicationRepository(db);
  const publication = await publications.findById(publicationId);
  if (!publication) throw new NotFoundError('Publication not found.');
  const before = await requireDomainOfPublication(
    publications,
    publicationId,
    domainId,
  );

  // Removing the primary: promote a replacement first, or refuse for an ACTIVE
  // Publication with no enabled replacement.
  if (before.is_primary) {
    await promoteReplacementPrimary(
      db,
      actor,
      publication,
      domainId,
      'primary_removed',
    );
  }

  await publications.removeDomain(domainId);

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_DOMAIN_REMOVE',
    actorIdentifier: actor.username,
    targetType: 'publication_domain',
    targetId: domainId,
    before: auditDomainView(before),
    metadata: { role: actor.role, publication_id: publicationId },
  });
}
