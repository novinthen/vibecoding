/**
 * Provider-neutral contract for text embeddings (Stage 7).
 *
 * Clustering depends on this capability — "given a block of text, return a
 * fixed-dimension numeric vector" — never on a specific vendor. This mirrors the
 * Stage 6 AI provider boundary: swapping providers means implementing this
 * interface and nothing else in the clustering engine changes. Embeddings are
 * DERIVED data; the provenance fields (`name`, `model`, `version`, `dimensions`)
 * are persisted with every stored vector so a later model/pipeline upgrade is
 * distinguishable and never silently destroys prior provenance.
 */
export interface EmbeddingProvider {
  /** Stable provider slug persisted as `provider` (e.g. "fake"). */
  readonly name: string;
  /** Model identifier persisted as `model` (e.g. "fake-embed-64"). */
  readonly model: string;
  /**
   * Monotonic pipeline version persisted as `embedding_version`. Bumped when the
   * embedding method changes in a way that makes old vectors incomparable, so
   * candidate generation only ever compares vectors of the same (model, version).
   */
  readonly version: number;
  /** Fixed output dimensionality. Every vector this provider returns has this length. */
  readonly dimensions: number;
  /**
   * Embed one text into a `dimensions`-length vector. Implementations MUST be
   * deterministic for a given input (equal text => equal vector) so CI never
   * depends on a live API and clustering results are reproducible.
   */
  embed(text: string): Promise<number[]>;
}
