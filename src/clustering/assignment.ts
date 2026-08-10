import type { Pool } from 'pg';

import { getPool, withTransaction, type Db } from '@/db/client';
import {
  ArticleRepository,
  ClusteringDecisionRepository,
  StoryEmbeddingRepository,
  StoryRepository,
  slugify,
  type RecordDecisionInput,
} from '@/domain';
import {
  PROTECTED_STORY_REVIEW_STATES,
  type ClusteringSource,
} from '@/domain/enums';
import type {
  ArticleRow,
  ClusteringCandidateRecord,
  ClusteringDecisionRow,
  StoryRow,
} from '@/domain/types';

import { generateCandidates, type CandidateOptions } from './candidates';
import { resolveEmbeddingProvider } from './embedding/config';
import { ensureArticleEmbedding } from './embedding/service';
import type { EmbeddingProvider } from './embedding/types';
import {
  ClusterArticleNotFoundError,
  ClusteringIneligibleError,
} from './errors';
import {
  rankCandidates,
  selectAssignment,
  signalsRecord,
  SCORING_VERSION,
  type ArticleFeatures,
  type RankedCandidate,
} from './scoring';
import { tokenSet } from './tokens';

/**
 * Story assignment engine (Stage 7) — the orchestration from Article to Story.
 *
 * Flow: ensure embedding -> generate bounded candidates -> deterministic
 * multi-signal scoring -> conservative decision -> apply inside a short,
 * advisory-locked transaction -> append an auditable ClusteringDecision.
 *
 * Guarantees, by construction:
 *  - it NEVER mutates Article source facts, NEVER publishes, NEVER deletes
 *    Article evidence, and NEVER silently merges two reviewed Stories;
 *  - it biases to false-split over false-merge: a hard evidence gate, a
 *    conservative threshold, and an AMBIGUOUS outcome (no merge) for close calls;
 *  - it is idempotent: re-processing an already-clustered Article is a no-op, and
 *    the (story, article) primary key means the same Article is never linked to
 *    the same Story twice;
 *  - it is concurrency-safe: per-Article version/assignment work happens under a
 *    transaction-scoped advisory lock, and membership is re-checked inside it;
 *  - a REVIEWED/LOCKED Story is never auto-modified (SKIPPED_PROTECTED).
 */

/** Stable method identifier recorded on every decision/attachment. */
export const CLUSTERING_METHOD = 'deterministic';

/**
 * Advisory-lock namespace for per-Article clustering. Combined with
 * hashtext(article_id) it serialises clustering for one Article while different
 * Articles proceed in parallel. Exported so tests can take the identical lock.
 */
export const CLUSTERING_LOCK_NAMESPACE = 0x636c75; // "clu"

export interface ClusterArticleOptions {
  candidates?: CandidateOptions;
  /** Re-cluster even if the Article already belongs to a Story. */
  force?: boolean;
  /** Bypass the eligibility gate (explicit admin override). */
  bypassEligibility?: boolean;
  /** AUTOMATIC (engine) or MANUAL (editor-initiated run). Default AUTOMATIC. */
  decisionSource?: ClusteringSource;
}

export interface ClusterArticleDeps {
  pool?: Pool;
  embeddingProvider?: EmbeddingProvider;
  /**
   * Extra work run INSIDE the same transaction that applies the decision and
   * records the ClusteringDecision (e.g. an admin audit write), so they commit
   * atomically. Must do no network I/O.
   */
  onDecision?: (
    tx: Db,
    decision: ClusteringDecisionRow,
    story: StoryRow | null,
  ) => Promise<void>;
}

export interface ClusterArticleResult {
  decision: ClusteringDecisionRow;
  /** The chosen/created Story, or null for AMBIGUOUS/skipped outcomes. */
  story: StoryRow | null;
}

/**
 * Eligibility gate (cost/quality seam). Conservative: skip items removed from the
 * pipeline and items with no title text to compare. Pure and side-effect free.
 */
export function isEligibleForClustering(article: ArticleRow): {
  eligible: boolean;
  reason?: string;
} {
  if (
    article.status === 'HIDDEN' ||
    article.status === 'DUPLICATE' ||
    article.status === 'FAILED'
  ) {
    return {
      eligible: false,
      reason: `Article status ${article.status} is excluded from clustering.`,
    };
  }
  const title = (
    article.normalized_title ||
    article.original_title ||
    ''
  ).trim();
  if (!title) {
    return { eligible: false, reason: 'Article has no title to cluster on.' };
  }
  return { eligible: true };
}

/**
 * Cluster one Article. The provider call and candidate scoring happen with NO
 * database transaction open; only the short apply step is transactional and
 * advisory-locked. Throws only for caller errors (missing/ineligible Article),
 * which write nothing.
 */
export async function clusterArticle(
  articleId: string,
  options: ClusterArticleOptions = {},
  deps: ClusterArticleDeps = {},
): Promise<ClusterArticleResult> {
  const pool = deps.pool ?? getPool();
  const provider = deps.embeddingProvider ?? resolveEmbeddingProvider();
  const decisionSource: ClusteringSource =
    options.decisionSource ?? 'AUTOMATIC';

  const article = await new ArticleRepository(pool).findById(articleId);
  if (!article) throw new ClusterArticleNotFoundError();

  if (!options.bypassEligibility) {
    const eligibility = isEligibleForClustering(article);
    if (!eligibility.eligible) {
      throw new ClusteringIneligibleError(
        eligibility.reason ?? 'Article is not eligible for clustering.',
      );
    }
  }

  // Ensure the Article's embedding exists (provider call happens here, no tx).
  const embedding = await ensureArticleEmbedding(pool, provider, article);

  // Fast idempotency short-circuit (re-checked authoritatively inside the tx).
  const existingStoryIds = await new StoryRepository(
    pool,
  ).listStoryIdsForArticle(articleId);
  const articleEntityIds = await loadArticleEntityIds(pool, articleId);

  const articleFeatures: ArticleFeatures = {
    embedding: embedding.vector,
    titleTokens: tokenSet(
      article.normalized_title || article.original_title || '',
    ),
    entityIds: articleEntityIds,
    publishedAt: article.published_at ? new Date(article.published_at) : null,
  };

  // Candidate generation + scoring (no tx). Skipped entirely when the Article is
  // already clustered and we are not forcing a re-run.
  const ranked =
    existingStoryIds.length > 0 && !options.force
      ? []
      : rankCandidates(
          articleFeatures,
          await generateCandidates({
            db: pool,
            article,
            embedding: embedding.vector,
            model: provider.model,
            articleEntityIds,
            excludeStoryIds: existingStoryIds,
            options: options.candidates,
          }),
        );

  const embeddingProvenance = {
    embeddingProvider: provider.name,
    embeddingModel: provider.model,
    embeddingVersion: provider.version,
  };

  // Apply the decision under a per-Article advisory lock.
  return withTransaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1, hashtext($2::text))', [
      CLUSTERING_LOCK_NAMESPACE,
      articleId,
    ]);

    const stories = new StoryRepository(tx);
    const decisions = new ClusteringDecisionRepository(tx);

    // Authoritative idempotency re-check inside the lock: a concurrent run may
    // have clustered this Article while we scored candidates.
    const currentStoryIds = await stories.listStoryIdsForArticle(articleId);
    if (currentStoryIds.length > 0 && !options.force) {
      return finalize(
        tx,
        decisions,
        {
          articleId,
          storyId: currentStoryIds[0] ?? null,
          decision: 'SKIPPED_EXISTING',
          decisionSource,
          reason: 'Article is already clustered; no change on re-run.',
          candidates: [],
          ...embeddingProvenance,
        },
        null,
        deps.onDecision,
      );
    }

    const selection = selectAssignment(ranked);
    const candidateRecords = ranked.map(toCandidateRecord);
    const topScore = ranked[0]?.score ?? null;

    if (
      selection.outcome === 'AMBIGUOUS' &&
      selection.best &&
      selection.runnerUp
    ) {
      return finalize(
        tx,
        decisions,
        {
          articleId,
          storyId: null,
          decision: 'AMBIGUOUS',
          decisionSource,
          topScore,
          candidateCount: ranked.length,
          reason: `Two Stories matched within the ambiguity margin (${selection.best.score.toFixed(
            3,
          )} vs ${selection.runnerUp.score.toFixed(3)}); left unclustered for review.`,
          candidates: candidateRecords,
          ...embeddingProvenance,
        },
        null,
        deps.onDecision,
      );
    }

    if (selection.outcome === 'ASSIGN' && selection.best) {
      const best = selection.best;
      const target = await stories.findById(best.storyId);
      // Protect editor decisions: never auto-attach to a REVIEWED/LOCKED Story.
      if (target && PROTECTED_STORY_REVIEW_STATES.has(target.review_state)) {
        return finalize(
          tx,
          decisions,
          {
            articleId,
            storyId: target.id,
            decision: 'SKIPPED_PROTECTED',
            decisionSource,
            topScore,
            confidence: best.score,
            candidateCount: ranked.length,
            reason: `Best match Story is ${target.review_state}; left for explicit editorial review.`,
            candidates: candidateRecords,
            signals: signalsRecord(best.signals),
            ...embeddingProvenance,
          },
          target,
          deps.onDecision,
        );
      }

      await stories.attachArticle(best.storyId, articleId, {
        relationshipType: 'RELATED',
        confidence: best.score,
        assignmentSource: decisionSource,
        clusteringMethod: CLUSTERING_METHOD,
        clusteringVersion: SCORING_VERSION,
        score: best.score,
        decisionReason: 'Confident single match above assign threshold.',
        signals: signalsRecord(best.signals),
      });
      await stories.touchActivity(best.storyId, article.published_at);

      return finalize(
        tx,
        decisions,
        {
          articleId,
          storyId: best.storyId,
          decision: 'ASSIGNED_EXISTING',
          decisionSource,
          topScore,
          confidence: best.score,
          candidateCount: ranked.length,
          reason: 'Confident single match above assign threshold.',
          candidates: candidateRecords,
          signals: signalsRecord(best.signals),
          ...embeddingProvenance,
        },
        target,
        deps.onDecision,
      );
    }

    // CREATE: no confident match -> form a new (reviewable, unpublished) Story.
    const story = await createStoryFromArticle(tx, article, decisionSource);
    // Seed the Story's representative embedding with the Article's embedding.
    await new StoryEmbeddingRepository(tx).upsert(story.id, {
      provider: embedding.row.provider ?? provider.name,
      model: provider.model,
      version: provider.version,
      dimensions: provider.dimensions,
      embedding: embedding.vector,
      sourceContentHash: embedding.row.source_content_hash ?? '',
    });
    await copyArticleEntitiesToStory(tx, articleId, story.id);

    const createdReason =
      ranked.length === 0
        ? 'No candidate Stories in window; formed a new Story.'
        : 'No candidate passed the assign threshold; formed a new Story.';
    return finalize(
      tx,
      decisions,
      {
        articleId,
        storyId: story.id,
        decision: 'CREATED_STORY',
        decisionSource,
        topScore,
        candidateCount: ranked.length,
        reason: createdReason,
        candidates: candidateRecords,
        ...embeddingProvenance,
      },
      story,
      deps.onDecision,
    );
  }, pool);
}

/** Record the decision row and run the optional in-transaction hook. */
async function finalize(
  tx: Db,
  decisions: ClusteringDecisionRepository,
  input: Omit<RecordDecisionInput, 'method' | 'methodVersion'>,
  story: StoryRow | null,
  onDecision: ClusterArticleDeps['onDecision'],
): Promise<ClusterArticleResult> {
  const decision = await decisions.record({
    method: CLUSTERING_METHOD,
    methodVersion: SCORING_VERSION,
    ...input,
  });
  if (onDecision) await onDecision(tx, decision, story);
  return { decision, story };
}

/** Create a new Story anchored on `article` (provisional, evidence-based title). */
async function createStoryFromArticle(
  tx: Db,
  article: ArticleRow,
  decisionSource: ClusteringSource,
): Promise<StoryRow> {
  const stories = new StoryRepository(tx);
  const title = (
    article.normalized_title ||
    article.original_title ||
    'Story'
  ).trim();
  const base = slugify(title).slice(0, 80) || 'story';
  // A short random suffix guarantees uniqueness without a fetch/retry loop.
  const slug = `${base}-${randomSuffix()}`;

  const story = await stories.createClustered({
    slug,
    canonicalTitle: title,
    primaryArticleId: article.id,
    formationSource: decisionSource,
    clusteringMethod: CLUSTERING_METHOD,
    clusteringVersion: SCORING_VERSION,
    lastActivityAt: article.published_at,
  });
  await stories.attachArticle(story.id, article.id, {
    relationshipType: 'PRIMARY',
    assignmentSource: decisionSource,
    clusteringMethod: CLUSTERING_METHOD,
    clusteringVersion: SCORING_VERSION,
    decisionReason: 'Seed Article for a newly formed Story.',
  });
  return story;
}

/** Copy an Article's canonical Entity links onto a freshly created Story. */
async function copyArticleEntitiesToStory(
  tx: Db,
  articleId: string,
  storyId: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO story_entities (story_id, entity_id, relationship)
     SELECT $1, ae.entity_id, 'MENTION'
     FROM article_entities ae
     WHERE ae.article_id = $2
     ON CONFLICT (story_id, entity_id) DO NOTHING`,
    [storyId, articleId],
  );
}

async function loadArticleEntityIds(
  db: Db,
  articleId: string,
): Promise<Set<string>> {
  const result = await db.query<{ entity_id: string }>(
    'SELECT entity_id FROM article_entities WHERE article_id = $1',
    [articleId],
  );
  return new Set(result.rows.map((row) => row.entity_id));
}

function toCandidateRecord(
  candidate: RankedCandidate,
): ClusteringCandidateRecord {
  return {
    storyId: candidate.storyId,
    representativeArticleId: candidate.representativeArticleId,
    score: candidate.score,
    passesThreshold: candidate.passesThreshold,
    signals: signalsRecord(candidate.signals),
    sources: candidate.sources,
  };
}

function randomSuffix(): string {
  return crypto.randomUUID().slice(0, 8);
}
