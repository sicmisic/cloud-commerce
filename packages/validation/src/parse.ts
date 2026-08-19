import { type z } from 'zod';

/**
 * Thin wrapper that turns a Zod failure into a flat, transport-friendly shape.
 * The API error middleware turns {@link ValidationFailure} into a 422 body;
 * business code never sees a raw `ZodError`.
 */

export interface FieldIssue {
  path: string;
  message: string;
}

export class ValidationFailure extends Error {
  readonly issues: FieldIssue[];
  constructor(issues: FieldIssue[]) {
    super(`Request validation failed: ${issues.map((i) => i.path).join(', ')}`);
    this.name = 'ValidationFailure';
    this.issues = issues;
  }
}

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationFailure(
    result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  );
}

export function safeParse<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; issues: FieldIssue[] } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  };
}
