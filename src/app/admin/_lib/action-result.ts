import { ZodError } from 'zod';

import { UnauthorizedError } from '@/admin/auth/guard';
import { AdminValidationError, NotFoundError } from '@/admin/errors';

/**
 * Shared shape and error-mapping for admin server actions.
 *
 * Actions return this state so client forms (useActionState) can render field
 * and form-level errors. Mapping is deliberately conservative: it never echoes
 * raw exception text that could leak internal detail — Zod issues become tidy
 * field messages, business-rule errors map to their field, and anything else
 * becomes a generic message while the real error is logged server-side.
 */
export interface ActionState {
  ok?: boolean;
  error?: string;
  /** Optional success detail shown alongside `ok` (e.g. an enrichment outcome). */
  message?: string;
  fieldErrors?: Record<string, string>;
}

export function fieldErrorsFromZod(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/** Map a thrown error to an ActionState without leaking internals. */
export function toActionState(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return {
      error: 'Please fix the highlighted fields.',
      fieldErrors: fieldErrorsFromZod(error),
    };
  }
  if (error instanceof AdminValidationError) {
    return {
      error: error.message,
      fieldErrors: { [error.field]: error.message },
    };
  }
  if (error instanceof NotFoundError) {
    return { error: error.message };
  }
  if (error instanceof UnauthorizedError) {
    return { error: 'You are not authorized to perform this action.' };
  }
  // Unexpected: log server-side, return a generic message.
  console.error('[admin action] unexpected error:', error);
  return { error: 'Something went wrong. Please try again.' };
}
