// ============================================================
// Gemini API Wrapper
// Centralizes all Gemini API calls behind a fallback chain:
//   gemini-3.6-flash -> gemini-3.5-flash-lite -> gemini-2.5-flash-lite
//
// Error routing:
// - 404 / 429            -> advance to next model immediately
// - 500 / 503             -> retry same model (1s, then 3s), then advance
// - 400 / 401 / 403       -> fail immediately, no retry, no advance
//
// The API key is only ever used to build the request URL/headers.
// It is never logged, printed, or included in thrown error messages.
// ============================================================

import type {
  GeminiWrapper,
  GeminiResponse,
  FallbackModelConfig,
  RetryConfig,
} from '@/types';

/** Base URL for the Gemini Developer API (generateContent). */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The fallback chain, in order. This matches the exact model IDs specified
 * in the project spec. See NOTES.md / handoff report for verification of
 * current availability of each ID against the live Gemini API.
 */
export const FALLBACK_CHAIN: FallbackModelConfig[] = [
  { id: 'gemini-3.6-flash', role: 'primary' },
  { id: 'gemini-3.5-flash-lite', role: 'first-fallback' },
  { id: 'gemini-2.5-flash-lite', role: 'second-fallback' },
];

/**
 * Retry configuration for HTTP 500/503 server errors.
 * Delays: 1s before the first retry, 3s before the second retry.
 * After maxRetries additional retries are exhausted, the wrapper
 * advances to the next model in the chain.
 */
export const RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 3000,
};

/**
 * Error thrown for any non-OK HTTP response from the Gemini API.
 * `status` drives the wrapper's routing logic (advance / retry / fail).
 */
export class GeminiApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'GeminiApiError';
  }
}

/**
 * Thrown internally when a single model has exhausted its server-error
 * retries (500/503). Caught by the outer fallback loop and treated the
 * same as a 404/429 — advance to the next model.
 */
export class GeminiRetriesExhaustedError extends Error {
  constructor(
    public readonly modelId: string,
    public readonly lastStatus: number
  ) {
    super(`Model ${modelId} failed after ${RETRY_CONFIG.maxRetries} retries (last status ${lastStatus}).`);
    this.name = 'GeminiRetriesExhaustedError';
  }
}

/**
 * Thrown when every model in the fallback chain has failed via 404/429.
 * The extension should stop making cloud calls and preserve previously
 * indexed Backboard data when this is thrown.
 */
export class GeminiChainExhaustedError extends Error {
  constructor(message = 'All Gemini fallback models are exhausted (404/429). Cloud calls stopped.') {
    super(message);
    this.name = 'GeminiChainExhaustedError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 500/503 are retried on the same model before advancing. */
function isServerError(status: number): boolean {
  return status === 500 || status === 503;
}

/** 400/401/403 fail immediately — no retry, no model advance. */
function isNoRetryClientError(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

/** 404/429 advance to the next model immediately. */
function isAdvanceStatus(status: number): boolean {
  return status === 404 || status === 429;
}

/** Delay before retry N (0-indexed): 1s before the 1st retry, 3s before the 2nd. */
function getRetryDelay(attempt: number): number {
  return attempt === 0 ? RETRY_CONFIG.baseDelayMs : RETRY_CONFIG.maxDelayMs;
}

function buildUrl(modelId: string, apiKey: string): string {
  return `${GEMINI_API_BASE}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

/**
 * Extract the generated text from a Gemini generateContent response.
 * Thinking-enabled models may return multiple parts; "thought" parts
 * are skipped in favor of the final text part.
 */
function extractContent(data: unknown): string {
  const parts = (data as any)?.candidates?.[0]?.content?.parts ?? [];
  const textParts = parts.filter((p: any) => p?.text && !p?.thought);
  if (textParts.length > 0) {
    return textParts[textParts.length - 1].text;
  }
  return parts[parts.length - 1]?.text ?? '';
}

function extractTokensUsed(data: unknown): number {
  return (data as any)?.usageMetadata?.totalTokenCount ?? 0;
}

/**
 * Gemini API Wrapper implementation.
 *
 * Tracks a "current model index" so that once a model in the chain has
 * been proven unusable for this session (404/429), subsequent execute()
 * calls don't waste a request re-trying it — they start from the last
 * known-good position. Successive calls after a successful response also
 * start from that model, since it's known to currently work.
 */
export class GeminiWrapperImpl implements GeminiWrapper {
  private currentModelIndex = 0;
  private exhausted = false;
  private lastUsedModel = '';

  async execute(params: {
    apiKey: string;
    prompt: string;
    taskType: 'generation' | 'embedding' | 'vision' | 'ocr';
  }): Promise<GeminiResponse> {
    const { apiKey, prompt } = params;

    if (this.exhausted) {
      throw new GeminiChainExhaustedError();
    }

    let lastAdvanceError: Error | null = null;

    for (let i = this.currentModelIndex; i < FALLBACK_CHAIN.length; i++) {
      const model = FALLBACK_CHAIN[i];

      try {
        const response = await this.callModelWithRetry(model.id, apiKey, prompt);
        this.currentModelIndex = i;
        this.lastUsedModel = model.id;
        return response;
      } catch (err) {
        if (this.shouldAdvance(err)) {
          lastAdvanceError = err as Error;
          this.currentModelIndex = i + 1;
          continue;
        }
        // 400/401/403 (or any unexpected error): fail immediately.
        // Do not advance the model pointer, do not mark the chain exhausted.
        throw err;
      }
    }

    // Every remaining model in the chain failed via 404/429 (or exhausted its retries).
    this.exhausted = true;
    throw new GeminiChainExhaustedError(
      lastAdvanceError
        ? `All fallback models exhausted. Last error: ${lastAdvanceError.message}`
        : undefined
    );
  }

  /**
   * True if this error should trigger "advance to next model":
   * either a direct 404/429 response, or a model that exhausted its
   * 500/503 retries.
   */
  private shouldAdvance(err: unknown): boolean {
    if (err instanceof GeminiRetriesExhaustedError) return true;
    if (err instanceof GeminiApiError && isAdvanceStatus(err.status)) return true;
    return false;
  }

  /**
   * Call a single model, retrying on 500/503 up to RETRY_CONFIG.maxRetries
   * times with backoff (1s, then 3s). Throws GeminiRetriesExhaustedError
   * once retries are used up, signaling the caller to advance models.
   */
  private async callModelWithRetry(
    modelId: string,
    apiKey: string,
    prompt: string
  ): Promise<GeminiResponse> {
    let attempt = 0;
    let lastStatus = 0;

    // attempt 0 = initial call; attempts 1..maxRetries = retries
    // total attempts made = 1 + maxRetries
    while (true) {
      try {
        return await this.callModel(modelId, apiKey, prompt);
      } catch (err) {
        if (err instanceof GeminiApiError && isServerError(err.status)) {
          lastStatus = err.status;

          if (attempt < RETRY_CONFIG.maxRetries) {
            await sleep(getRetryDelay(attempt));
            attempt++;
            continue;
          }

          throw new GeminiRetriesExhaustedError(modelId, lastStatus);
        }
        // 404/429/400/401/403/unexpected — bubble up unchanged for the
        // outer loop (execute) to route (advance or fail immediately).
        throw err;
      }
    }
  }

  /**
   * Make a single HTTP request to the Gemini generateContent endpoint
   * for the given model. Throws GeminiApiError on any non-OK response.
   */
  private async callModel(modelId: string, apiKey: string, prompt: string): Promise<GeminiResponse> {
    const url = buildUrl(modelId, apiKey);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      });
    } catch (err) {
      // Network-level failure (no HTTP response at all). Treated as a
      // transient server-side condition so it participates in the same
      // retry-then-advance behavior as a 500/503.
      throw new GeminiApiError(
        `Network error calling ${modelId}`,
        500,
        err instanceof Error ? err.message : 'Unknown network error'
      );
    }

    if (!response.ok) {
      const status = response.status;
      const body = await response.text().catch(() => '');

      if (isNoRetryClientError(status)) {
        throw new GeminiApiError(`Gemini API request rejected (${status}) by ${modelId}.`, status, body);
      }

      throw new GeminiApiError(`Gemini API error (${status}) from ${modelId}.`, status, body);
    }

    const data = await response.json();

    return {
      content: extractContent(data),
      model: modelId,
      tokensUsed: extractTokensUsed(data),
    };
  }

  /**
   * Returns the model that successfully handled the most recent request.
   * Returns an empty string if no request has succeeded yet.
   */
  getLastUsedModel(): string {
    return this.lastUsedModel;
  }

  /**
   * True once every model in the fallback chain has failed via 404/429
   * (or exhausted its 500/503 retries). While true, execute() throws
   * immediately without making any network requests.
   */
  isExhausted(): boolean {
    return this.exhausted;
  }

  /**
   * Restores the fallback chain to its initial state (start back at the
   * primary model, clear the exhausted flag) so cloud calls can resume —
   * e.g. after a new day's rate limit window opens.
   */
  resetChain(): void {
    this.currentModelIndex = 0;
    this.exhausted = false;
  }
}

/** Singleton instance for use across the extension. */
export const geminiWrapper = new GeminiWrapperImpl();
