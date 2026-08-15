// ============================================================
// Query Input Validation
// Validates user queries before sending to Backboard.io.
// ============================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 2000;

/**
 * Validate a query string before processing.
 * Rejects empty, whitespace-only, too short, or too long queries.
 */
export function validateQuery(query: string): ValidationResult {
  if (!query || query.trim().length === 0) {
    return { valid: false, error: 'Query cannot be empty.' };
  }

  const trimmed = query.trim();

  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { valid: false, error: `Query must be at least ${MIN_QUERY_LENGTH} characters.` };
  }

  if (trimmed.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: `Query must be ${MAX_QUERY_LENGTH} characters or fewer.` };
  }

  return { valid: true };
}
