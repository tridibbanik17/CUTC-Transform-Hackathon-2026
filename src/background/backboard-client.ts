// ============================================================
// Backboard.io Client Implementation
// Communicates with the Backboard.io backend for:
// - Document chunking and indexing
// - RAG query processing
// - Course status management
// - Deduplication checks
// All chunking, embedding, vector storage, and RAG orchestration
// are delegated to this service.
// ============================================================

import type {
  BackboardClient,
  ExtractedDocument,
  IndexingResult,
  RAGResponse,
  CourseStatus,
} from '@/types';

/** Backboard.io API base URL */
const BACKBOARD_API_BASE = 'https://api.backboard.io/v1';

/** Retry configuration for server errors */
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

/**
 * HTTP error class with status code for routing retry/fallback logic.
 */
export class BackboardApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'BackboardApiError';
  }
}

/**
 * Exponential backoff delay: baseDelay * 2^attempt (1s, 2s)
 */
function getRetryDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt);
}

/**
 * Sleep utility for retry delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines if an HTTP status code is retryable (server errors).
 */
function isRetryableStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Determines if an HTTP status code should fail immediately (client errors).
 */
function isClientError(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

/**
 * Makes an HTTP request to Backboard.io with retry logic.
 * - 500/502/503/504: retry up to 2x with exponential backoff
 * - 400/401/403: fail immediately
 * - 429/404: throw (caller routes to Gemini wrapper fallback)
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit
): Promise<Response> {
  let lastError: BackboardApiError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      const status = response.status;
      const body = await response.text().catch(() => '');

      // Client errors — fail immediately, no retry
      if (isClientError(status)) {
        throw new BackboardApiError(
          `Backboard.io request failed: ${status} ${response.statusText}`,
          status,
          body
        );
      }

      // Rate limit or not found — throw for fallback routing
      if (status === 429 || status === 404) {
        throw new BackboardApiError(
          `Backboard.io request failed: ${status} ${response.statusText}`,
          status,
          body
        );
      }

      // Server errors — retry with backoff
      if (isRetryableStatus(status)) {
        lastError = new BackboardApiError(
          `Backboard.io server error: ${status} ${response.statusText}`,
          status,
          body
        );

        if (attempt < MAX_RETRIES) {
          await sleep(getRetryDelay(attempt));
          continue;
        }
      }

      // Any other status — throw
      throw new BackboardApiError(
        `Backboard.io unexpected error: ${status} ${response.statusText}`,
        status,
        body
      );
    } catch (err) {
      if (err instanceof BackboardApiError) {
        throw err;
      }
      // Network error — treat as retryable
      lastError = new BackboardApiError(
        `Network error: ${err instanceof Error ? err.message : 'Unknown'}`,
        0
      );
      if (attempt < MAX_RETRIES) {
        await sleep(getRetryDelay(attempt));
        continue;
      }
    }
  }

  throw lastError ?? new Error('Backboard.io request failed after retries');
}

/**
 * Build common request headers for Backboard.io API calls.
 */
function buildHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * Backboard.io client implementation.
 */
export class BackboardClientImpl implements BackboardClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = BACKBOARD_API_BASE) {
    this.baseUrl = baseUrl;
  }

  /**
   * Send extracted document text for chunking and indexing on Backboard.io.
   */
  async indexDocument(params: {
    courseId: string;
    apiKey: string;
    document: ExtractedDocument;
    contentHash: string;
  }): Promise<IndexingResult> {
    const { courseId, apiKey, document, contentHash } = params;

    const response = await fetchWithRetry(
      `${this.baseUrl}/courses/${encodeURIComponent(courseId)}/documents`,
      {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: JSON.stringify({
          document: {
            fileName: document.fileName,
            fileType: document.fileType,
            pages: document.pages,
            totalCharacters: document.totalCharacters,
          },
          contentHash,
        }),
      }
    );

    return (await response.json()) as IndexingResult;
  }

  /**
   * Check if a document has already been indexed by its content hash.
   * Used for deduplication — avoids re-indexing unchanged documents.
   */
  async hasDocument(courseId: string, apiKey: string, hash: string): Promise<boolean> {
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/courses/${encodeURIComponent(courseId)}/documents/check?hash=${encodeURIComponent(hash)}`,
        {
          method: 'GET',
          headers: buildHeaders(apiKey),
        }
      );

      const result = (await response.json()) as { exists: boolean };
      return result.exists;
    } catch (err) {
      if (err instanceof BackboardApiError && err.status === 404) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Submit a query for RAG processing.
   * Backboard.io handles embedding the query, similarity search, and answer generation.
   */
  async query(params: {
    courseId: string;
    apiKey: string;
    queryText: string;
  }): Promise<RAGResponse> {
    const { courseId, apiKey, queryText } = params;

    const response = await fetchWithRetry(
      `${this.baseUrl}/courses/${encodeURIComponent(courseId)}/query`,
      {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: JSON.stringify({ queryText }),
      }
    );

    return (await response.json()) as RAGResponse;
  }

  /**
   * Get course indexing status and stats from Backboard.io.
   */
  async getCourseStatus(courseId: string, apiKey: string): Promise<CourseStatus> {
    const response = await fetchWithRetry(
      `${this.baseUrl}/courses/${encodeURIComponent(courseId)}/status`,
      {
        method: 'GET',
        headers: buildHeaders(apiKey),
      }
    );

    return (await response.json()) as CourseStatus;
  }

  /**
   * Replace entire course index atomically.
   * On success, new index replaces old. On failure, old index is retained.
   */
  async replaceCourseIndex(
    courseId: string,
    apiKey: string,
    documents: ExtractedDocument[]
  ): Promise<IndexingResult> {
    const response = await fetchWithRetry(
      `${this.baseUrl}/courses/${encodeURIComponent(courseId)}/reindex`,
      {
        method: 'PUT',
        headers: buildHeaders(apiKey),
        body: JSON.stringify({
          documents: documents.map((doc) => ({
            fileName: doc.fileName,
            fileType: doc.fileType,
            pages: doc.pages,
            totalCharacters: doc.totalCharacters,
          })),
        }),
      }
    );

    return (await response.json()) as IndexingResult;
  }

  /**
   * Delete all indexed data for a course from Backboard.io.
   */
  async deleteCourse(courseId: string, apiKey: string): Promise<void> {
    await fetchWithRetry(
      `${this.baseUrl}/courses/${encodeURIComponent(courseId)}`,
      {
        method: 'DELETE',
        headers: buildHeaders(apiKey),
      }
    );
  }
}

/** Singleton instance for use across the extension */
export const backboardClient = new BackboardClientImpl();
