/**
 * Admin-domain errors (Stage 4).
 *
 * Distinct from Zod schema errors: these represent business-rule violations that
 * can only be checked against current database state (e.g. a duplicate slug, or
 * a parent Topic that is not top-level). Server actions map them to a friendly
 * field/form message; they never leak internal details.
 */
export class AdminValidationError extends Error {
  constructor(
    /** The form field this error belongs to, or 'form' for a general error. */
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminValidationError';
  }
}

/** Thrown when a mutation targets a record that does not exist. */
export class NotFoundError extends Error {
  constructor(message = 'Record not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}
