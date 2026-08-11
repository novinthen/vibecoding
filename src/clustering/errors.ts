/** Thrown when clustering is requested for a missing Article. */
export class ClusterArticleNotFoundError extends Error {
  constructor(message = 'Article not found.') {
    super(message);
    this.name = 'ClusterArticleNotFoundError';
  }
}

/** Thrown when an Article is not eligible for clustering (and force is not set). */
export class ClusteringIneligibleError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ClusteringIneligibleError';
  }
}
