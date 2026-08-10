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

  const created = await publications.addDomain({
    publicationId,
    domain: values.domain,
    // First domain (or an explicit request) becomes primary. The partial unique
    // index still guards the one-primary invariant.
    isPrimary: values.isPrimary,
    enabled: true,
  });

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_DOMAIN_ADD',
    actorIdentifier: actor.username,
    targetType: 'publication_domain',
    targetId: created.id,
    after: auditDomainView(created),
    metadata: { role: actor.role, publication_id: publicationId },
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

export async function setPublicationDomainEnabled(
  db: Db,
  actor: AdminSession,
  publicationId: string,
  domainId: string,
  enabled: boolean,
): Promise<PublicationDomainRow> {
  assertCanMutate(actor);
  const publications = new PublicationRepository(db);
  const before = await requireDomainOfPublication(
    publications,
    publicationId,
    domainId,
  );

  const updated = await publications.setDomainEnabled(domainId, enabled);
  if (!updated) throw new NotFoundError('Domain not found.');

  await new AdminAuditLogRepository(db).record({
    action: enabled
      ? 'PUBLICATION_DOMAIN_ENABLE'
      : 'PUBLICATION_DOMAIN_DISABLE',
    actorIdentifier: actor.username,
    targetType: 'publication_domain',
    targetId: domainId,
    before: { enabled: before.enabled },
    after: { enabled: updated.enabled },
    metadata: { role: actor.role, publication_id: publicationId },
  });
  return updated;
}

export async function setPrimaryPublicationDomain(
  db: Db,
  actor: AdminSession,
  publicationId: string,
  domainId: string,
): Promise<PublicationDomainRow> {
  assertCanMutate(actor);
  const publications = new PublicationRepository(db);
  await requireDomainOfPublication(publications, publicationId, domainId);

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
  const before = await requireDomainOfPublication(
    publications,
    publicationId,
    domainId,
  );

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
