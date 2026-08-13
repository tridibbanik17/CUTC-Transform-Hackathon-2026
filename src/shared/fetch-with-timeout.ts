// ============================================================
// fetchWithTimeout
// ------------------------------------------------------------
// Wraps the global `fetch` with an AbortController-based timeout
// so network calls (Gemini API key validation, LLM queries, PDF
// downloads during indexing) can never hang the UI indefinitely.
// On timeout, the returned promise rejects with a `FetchTimeoutError`
// so callers can present a clear "request timed out" message
// instead of leaving the side panel stuck on a loading state.
// ============================================================

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'FetchTimeoutError';
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Perform a `fetch` that automatically aborts (and rejects with a
 * `FetchTimeoutError`) if it does not complete within `timeoutMs`.
 * Safe to use anywhere a bare `fetch` was previously used — the
 * returned promise still resolves to a `Response` on success.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
