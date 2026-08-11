import { jaccard } from './tokens';

/**
 * Deterministic multi-signal similarity scoring for Story clustering (Stage 7).
 *
 * The decision to attach an Article to a Story is NEVER made on cosine similarity
 * alone, and NEVER by an opaque LLM. It combines several explainable signals with
 * fixed weights and fixed thresholds, versioned as {@link SCORING_VERSION}. The
 * whole model is pure and side-effect free, so it is exhaustively unit-testable
 * and reproducible.
 *
 * Bias: false split > false merge. A hard gate blocks weak-evidence merges, the
 * assign threshold is conservative, and two similarly-strong candidates are
 * declared AMBIGUOUS (no merge) rather than guessed.
 */

/** Version of the scoring formula; recorded on every decision and attachment. */
export const SCORING_VERSION = 'cluster-score-v1';

/** Signal weights. Sum to 1 so a perfect match on every signal scores 1.0. */
export const WEIGHTS = {
  embedding: 0.55,
  title: 0.3,
  entity: 0.1,
  temporal: 0.05,
} as const;

/** Minimum combined score to attach to an existing Story. */
export const ASSIGN_THRESHOLD = 0.72;

/**
 * Hard gate: a candidate is only eligible for assignment if it shows strong
 * primary evidence — high embedding similarity OR high title overlap. This stops
 * a merge driven only by weak secondary signals (shared entity + close time).
 */
export const MIN_EMBEDDING_SIMILARITY = 0.6;
export const MIN_TITLE_OVERLAP = 0.5;

/**
 * If the two best qualifying candidates are within this score margin, the match
 * is treated as AMBIGUOUS and no automatic merge happens (fail conservative).
 */
export const AMBIGUITY_MARGIN = 0.05;

/** Time constant (hours) for the temporal-proximity decay. */
const TEMPORAL_TAU_HOURS = 48;

export interface ArticleFeatures {
  embedding: number[];
  titleTokens: Set<string>;
  entityIds: Set<string>;
  publishedAt: Date | null;
}

export interface CandidateFeatures {
  storyId: string;
  representativeArticleId: string | null;
  embedding: number[];
  titleTokens: Set<string>;
  entityIds: Set<string>;
  lastActivityAt: Date | null;
  /** How the candidate surfaced during generation (for provenance/review). */
  sources: string[];
}

export interface ScoreSignals {
  embedding: number;
  title: number;
  entity: number;
  temporal: number;
}

/** Flatten the fixed-shape signals into a plain record for JSONB persistence. */
export function signalsRecord(signals: ScoreSignals): Record<string, number> {
  return {
    embedding: signals.embedding,
    title: signals.title,
    entity: signals.entity,
    temporal: signals.temporal,
  };
}

export interface CandidateScore {
  score: number;
  signals: ScoreSignals;
  /** Whether the hard evidence gate passed. */
  passesGate: boolean;
  /** Whether the candidate is eligible to be assigned (gate AND threshold). */
  passesThreshold: boolean;
}

export interface RankedCandidate extends CandidateScore {
  storyId: string;
  representativeArticleId: string | null;
  sources: string[];
}

export type SelectionOutcome = 'ASSIGN' | 'CREATE' | 'AMBIGUOUS';

export interface Selection {
  outcome: SelectionOutcome;
  best: RankedCandidate | null;
  runnerUp: RankedCandidate | null;
}

/**
 * Cosine similarity of two vectors, clamped to [0, 1]. Feature-hashed vectors can
 * be slightly negative for unrelated text; a negative cosine is no evidence of
 * the same event, so it is floored at 0. Returns 0 on a length mismatch (e.g.
 * vectors from different embedding models) rather than comparing incomparable
 * spaces.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, cos));
}

/**
 * Temporal proximity in [0, 1]: 1 when simultaneous, decaying with the hours
 * between the Article and the Story's last activity. Returns 0 when either
 * timestamp is unknown — absence is treated as no signal, never as closeness.
 */
export function temporalScore(
  articleAt: Date | null,
  storyAt: Date | null,
): number {
  if (!articleAt || !storyAt) return 0;
  const hours =
    Math.abs(articleAt.getTime() - storyAt.getTime()) / (1000 * 60 * 60);
  return 1 / (1 + hours / TEMPORAL_TAU_HOURS);
}

/** Score one candidate Story against an Article. Pure. */
export function scoreCandidate(
  article: ArticleFeatures,
  candidate: CandidateFeatures,
): CandidateScore {
  const signals: ScoreSignals = {
    embedding: cosineSimilarity(article.embedding, candidate.embedding),
    title: jaccard(article.titleTokens, candidate.titleTokens),
    entity: jaccard(article.entityIds, candidate.entityIds),
    temporal: temporalScore(article.publishedAt, candidate.lastActivityAt),
  };

  const score =
    WEIGHTS.embedding * signals.embedding +
    WEIGHTS.title * signals.title +
    WEIGHTS.entity * signals.entity +
    WEIGHTS.temporal * signals.temporal;

  const passesGate =
    signals.embedding >= MIN_EMBEDDING_SIMILARITY ||
    signals.title >= MIN_TITLE_OVERLAP;
  const passesThreshold = passesGate && score >= ASSIGN_THRESHOLD;

  return { score, signals, passesGate, passesThreshold };
}

/** Score and rank every candidate (highest score first). Pure. */
export function rankCandidates(
  article: ArticleFeatures,
  candidates: CandidateFeatures[],
): RankedCandidate[] {
  return candidates
    .map((candidate) => ({
      ...scoreCandidate(article, candidate),
      storyId: candidate.storyId,
      representativeArticleId: candidate.representativeArticleId,
      sources: candidate.sources,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Choose an assignment from ranked candidates. Conservative by construction:
 *  - no qualifying candidate            => CREATE a new Story;
 *  - exactly one clear winner           => ASSIGN to it;
 *  - two winners within AMBIGUITY_MARGIN => AMBIGUOUS (no automatic merge).
 *
 * `ranked` need not be pre-sorted; this re-filters and re-sorts defensively.
 */
export function selectAssignment(ranked: RankedCandidate[]): Selection {
  const qualifying = ranked
    .filter((candidate) => candidate.passesThreshold)
    .sort((a, b) => b.score - a.score);

  if (qualifying.length === 0) {
    return { outcome: 'CREATE', best: null, runnerUp: null };
  }
  const best = qualifying[0] as RankedCandidate;
  const runnerUp = qualifying[1] ?? null;
  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) {
    return { outcome: 'AMBIGUOUS', best, runnerUp };
  }
  return { outcome: 'ASSIGN', best, runnerUp };
}
