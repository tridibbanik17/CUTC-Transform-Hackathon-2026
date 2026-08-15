// ============================================================
// RAG Engine
// Orchestrates a single query end-to-end:
//   1. Validate the query (src/shared/validation.ts)
//   2. Call Backboard.io, which performs BOTH retrieval AND answer
//      generation (chunking, embeddings, vector search, and Gemini
//      generation using the user's own API key)
//   3. Route/clean the response: apply confidence thresholds, the
//      300-word cap, and citation-completeness filtering
//
// Architecture note (per Tridib's clarified decision): Backboard.io
// owns the full RAG pipeline, retrieval AND generation. This engine
// must NOT call the Gemini wrapper a second time to re-generate an
// answer for normal queries — that would be a redundant, unrequested
// second LLM call. The Gemini wrapper (Task #7) is reserved for
// direct-Gemini functionality outside the Backboard pipeline (e.g.
// future OCR/vision). Course isolation is enforced by always passing
// the caller-supplied courseId straight through to Backboard on every
// call — the RAG engine never caches or mixes state across courses.
// ============================================================

import type {
  RAGEngineAPI,
  RAGResponse,
  Citation,
  BackboardClient,
  APIKeyManager,
} from '@/types';
import { validateQuery } from '@/shared/validation';
import { backboardClient } from './backboard-client';
import { apiKeyManager } from './api-key-manager';

/** Confidence thresholds (see project spec section 17). */
const INSUFFICIENT_CONFIDENCE_THRESHOLD = 0.4;
const SUCCESS_CONFIDENCE_THRESHOLD = 0.6;

/** Generated answers must never exceed this many words. */
const MAX_ANSWER_WORDS = 1000;

/**
 * Thrown when the query fails validation (empty, too short, too long).
 * There's no RAGResponse status for "invalid input" in the current
 * types/index.ts contract, so this is thrown rather than returned —
 * see the report's "assumptions" section for why.
 */
export class QueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryValidationError';
  }
}

/**
 * Thrown when no Gemini API key is configured. Same reasoning as
 * QueryValidationError — no matching RAGResponse status exists.
 */
export class MissingApiKeyError extends Error {
  constructor(message = 'No Gemini API key configured.') {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}

/**
 * A citation is only usable if every required field (per project spec
 * section 19) is present and well-formed. sourceUrl remains optional.
 */
export function isCompleteCitation(citation: Citation): boolean {
  return (
    typeof citation.fileName === 'string' &&
    citation.fileName.trim().length > 0 &&
    Number.isInteger(citation.pageNumber) &&
    citation.pageNumber > 0 &&
    typeof citation.sectionHeading === 'string' &&
    citation.sectionHeading.trim().length > 0 &&
    typeof citation.relevanceScore === 'number' &&
    Number.isFinite(citation.relevanceScore)
  );
}

/** Filters out any citation missing a required field. */
export function filterCompleteCitations(citations: Citation[]): Citation[] {
  return citations.filter(isCompleteCitation);
}

/**
 * Truncates generated text to at most `maxWords` words. Whitespace-based
 * split — good enough to guarantee the hard cap without needing a full
 * tokenizer, and matches the "≤300 words" wording in the spec (not
 * "≤300 tokens").
 */
export function enforceWordLimit(text: string, maxWords: number = MAX_ANSWER_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text.trim();
  }
  return words.slice(0, maxWords).join(' ') + '…';
}

/**
 * RAG Engine implementation. Dependencies are injectable (defaulting to
 * the module singletons) purely to keep this testable without mocking
 * module resolution.
 *
 * Note: no GeminiWrapper dependency here on purpose — Backboard.io
 * performs generation internally. See the architecture note above.
 */
export class RAGEngineImpl implements RAGEngineAPI {
  constructor(
    private readonly backboard: BackboardClient = backboardClient,
    private readonly keyManager: APIKeyManager = apiKeyManager
  ) {}

  async processQuery(courseId: string, query: string): Promise<RAGResponse> {
    // --- Step 1: Validate the query using the existing shared validator ---
    const validation = validateQuery(query);
    if (!validation.valid) {
      throw new QueryValidationError(validation.error ?? 'Invalid query.');
    }
    const trimmedQuery = query.trim();

    // --- Step 2: Retrieve the API key ---
    const apiKey = await this.keyManager.getKey();
    if (!apiKey) {
      throw new MissingApiKeyError();
    }

    // --- Step 3: Backboard.io performs retrieval AND generation ---
    // Course isolation: courseId is passed through exactly as given on
    // every call, with no caching or cross-course state in this engine.
    let result: RAGResponse;
    try {
      result = await this.backboard.query({
        courseId,
        apiKey,
        queryText: trimmedQuery,
      });
    } catch {
      // Never hallucinate on a retrieval/generation failure (spec section 21).
      return {
        answer: '',
        citations: [],
        confidenceScore: 0,
        status: 'retrieval_error',
      };
    }

    const confidenceScore = result.confidenceScore;

    // --- Step 4: Confidence gate (spec section 17) ---
    if (confidenceScore < INSUFFICIENT_CONFIDENCE_THRESHOLD) {
      // Do not surface an answer — the indexed materials don't have
      // enough relevant information to answer responsibly, regardless
      // of what Backboard returned.
      return {
        answer: '',
        citations: [],
        confidenceScore,
        status: 'insufficient_information',
      };
    }

    // --- Step 5: Preserve Backboard's answer, clean up citations/length ---
    const citations = filterCompleteCitations(result.citations);
    const answer = enforceWordLimit(result.answer);
    const status = confidenceScore >= SUCCESS_CONFIDENCE_THRESHOLD ? 'success' : 'low_confidence';

    return { answer, citations, confidenceScore, status };
  }
}

/** Singleton instance for use across the extension. */
export const ragEngine = new RAGEngineImpl();
