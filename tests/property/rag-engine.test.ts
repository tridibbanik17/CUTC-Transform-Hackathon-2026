import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  RAGEngineImpl,
  QueryValidationError,
  MissingApiKeyError,
  isCompleteCitation,
  filterCompleteCitations,
  enforceWordLimit,
} from '../../src/background/rag-engine';
import type { BackboardClient, APIKeyManager, Citation } from '../../src/types';

// Spy that lets us assert nothing ever calls the Gemini wrapper's
// execute() from within the RAG engine. Backboard.io owns generation
// now — the RAG engine must never trigger a second LLM call.
const geminiExecuteSpy = vi.fn();
vi.mock('../../src/background/gemini-wrapper', () => ({
  geminiWrapper: { execute: geminiExecuteSpy },
}));

function makeCitation(overrides: Partial<Citation> = {}): Citation {
  return {
    fileName: 'Lecture 7 - Trees.pdf',
    pageNumber: 14,
    sectionHeading: 'Binary Trees',
    relevanceScore: 0.87,
    sourceUrl: 'https://example.com/lecture7#page=14',
    ...overrides,
  };
}

function makeBackboardStub(overrides: Partial<BackboardClient> = {}): BackboardClient {
  return {
    indexDocument: vi.fn(),
    hasDocument: vi.fn(),
    query: vi.fn(),
    getCourseStatus: vi.fn(),
    replaceCourseIndex: vi.fn(),
    deleteCourse: vi.fn(),
    ...overrides,
  } as unknown as BackboardClient;
}

function makeKeyManagerStub(key: string | null = 'AIzaSyTestKey'): APIKeyManager {
  return {
    storeKey: vi.fn(),
    getKey: vi.fn(async () => key),
    getMaskedKey: vi.fn(),
    validateKey: vi.fn(),
    removeKey: vi.fn(),
    hasKey: vi.fn(async () => key !== null),
  };
}

const validQuery = 'What topics are covered on the midterm?';

describe('RAGEngineImpl', () => {
  describe('processQuery — validation', () => {
    it.each(['', '  ', 'a', 'ab'])('rejects invalid query %j without calling Backboard', async (bad) => {
      const backboard = makeBackboardStub();
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      await expect(engine.processQuery('course-1', bad)).rejects.toThrow(QueryValidationError);
      expect(backboard.query).not.toHaveBeenCalled();
    });

    it('rejects a query over 2000 characters', async () => {
      const backboard = makeBackboardStub();
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      await expect(engine.processQuery('course-1', 'a'.repeat(2001))).rejects.toThrow(QueryValidationError);
      expect(backboard.query).not.toHaveBeenCalled();
    });

    it('accepts a valid query and calls Backboard', async () => {
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'The midterm covers recursion, linked lists, trees, and graph traversal.',
          citations: [makeCitation()],
          confidenceScore: 0.8,
          status: 'success' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      const result = await engine.processQuery('course-1', validQuery);
      expect(result.status).toBe('success');
      expect(backboard.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('processQuery — missing API key', () => {
    it('throws MissingApiKeyError and never calls Backboard', async () => {
      const backboard = makeBackboardStub();
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub(null));

      await expect(engine.processQuery('course-1', validQuery)).rejects.toThrow(MissingApiKeyError);
      expect(backboard.query).not.toHaveBeenCalled();
    });
  });

  // =========================================================
  // Core architecture requirement: NO second Gemini generation
  // =========================================================
  describe('processQuery — Backboard owns generation, no second Gemini call', () => {
    it('never calls geminiWrapper.execute() on a successful query', async () => {
      geminiExecuteSpy.mockClear();
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'Backboard-generated answer.',
          citations: [makeCitation()],
          confidenceScore: 0.9,
          status: 'success' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      await engine.processQuery('course-1', validQuery);

      expect(geminiExecuteSpy).not.toHaveBeenCalled();
    });

    it('never calls geminiWrapper.execute() on a low-confidence query', async () => {
      geminiExecuteSpy.mockClear();
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'Tentative Backboard answer.',
          citations: [makeCitation()],
          confidenceScore: 0.5,
          status: 'low_confidence' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      await engine.processQuery('course-1', validQuery);

      expect(geminiExecuteSpy).not.toHaveBeenCalled();
    });

    it('never calls geminiWrapper.execute() on an insufficient-confidence query', async () => {
      geminiExecuteSpy.mockClear();
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'weak context',
          citations: [makeCitation()],
          confidenceScore: 0.1,
          status: 'success' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      await engine.processQuery('course-1', validQuery);

      expect(geminiExecuteSpy).not.toHaveBeenCalled();
    });

    it('never calls geminiWrapper.execute() when Backboard itself fails', async () => {
      geminiExecuteSpy.mockClear();
      const backboard = makeBackboardStub({
        query: vi.fn(async () => {
          throw new Error('Backboard.io request failed: 503 Service Unavailable');
        }),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      await engine.processQuery('course-1', validQuery);

      expect(geminiExecuteSpy).not.toHaveBeenCalled();
    });

    it("preserves Backboard's answer text verbatim (subject only to the word cap)", async () => {
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'This exact sentence should come back untouched.',
          citations: [makeCitation()],
          confidenceScore: 0.9,
          status: 'success' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      const result = await engine.processQuery('course-1', validQuery);
      expect(result.answer).toBe('This exact sentence should come back untouched.');
    });

    it("preserves Backboard's citations (after completeness filtering)", async () => {
      const citation = makeCitation({ fileName: 'Lecture 9 - Graphs.pdf', pageNumber: 8 });
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'Graph traversal is covered in lecture 9.',
          citations: [citation],
          confidenceScore: 0.9,
          status: 'success' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      const result = await engine.processQuery('course-1', validQuery);
      expect(result.citations).toEqual([citation]);
    });
  });

  // =========================================================
  // Confidence routing (spec section 17)
  // =========================================================
  describe('processQuery — confidence routing', () => {
    it('returns insufficient_information with no answer/citations when confidence < 0.4', async () => {
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'weak context',
          citations: [makeCitation()],
          confidenceScore: 0.39,
          status: 'success' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      const result = await engine.processQuery('course-1', validQuery);

      expect(result).toEqual({
        answer: '',
        citations: [],
        confidenceScore: 0.39,
        status: 'insufficient_information',
      });
    });

    it('returns low_confidence and preserves the answer when 0.4 <= confidence < 0.6', async () => {
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'Here is a tentative answer.',
          citations: [makeCitation()],
          confidenceScore: 0.5,
          status: 'low_confidence' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      const result = await engine.processQuery('course-1', validQuery);

      expect(result.status).toBe('low_confidence');
      expect(result.answer).toBe('Here is a tentative answer.');
      expect(result.citations).toHaveLength(1);
    });

    it('returns success and preserves the answer when confidence >= 0.6', async () => {
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'Confident answer.',
          citations: [makeCitation()],
          confidenceScore: 0.87,
          status: 'success' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      const result = await engine.processQuery('course-1', validQuery);

      expect(result.status).toBe('success');
      expect(result.answer).toBe('Confident answer.');
    });

    it('property: status always matches the confidence bucket for any score in [0, 1]', async () => {
      await fc.assert(
        fc.asyncProperty(fc.double({ min: 0, max: 1, noNaN: true }), async (confidenceScore) => {
          const backboard = makeBackboardStub({
            query: vi.fn(async () => ({
              answer: 'context',
              citations: [makeCitation()],
              confidenceScore,
              status: 'success' as const,
            })),
          });
          const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

          const result = await engine.processQuery('course-1', validQuery);

          if (confidenceScore < 0.4) {
            expect(result.status).toBe('insufficient_information');
            expect(result.answer).toBe('');
            expect(result.citations).toEqual([]);
          } else if (confidenceScore < 0.6) {
            expect(result.status).toBe('low_confidence');
          } else {
            expect(result.status).toBe('success');
          }
          expect(result.confidenceScore).toBe(confidenceScore);
        }),
        { numRuns: 50 }
      );
    });
  });

  // =========================================================
  // 300-word answer cap (still applied to Backboard's answer)
  // =========================================================
  describe('300-word answer cap', () => {
    it('enforceWordLimit leaves short text untouched', () => {
      expect(enforceWordLimit('A short answer.')).toBe('A short answer.');
    });

    it('enforceWordLimit truncates text over the limit and appends an ellipsis', () => {
      const longText = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
      const result = enforceWordLimit(longText, 300);
      const wordCount = result.replace('…', '').trim().split(/\s+/).length;
      expect(wordCount).toBe(300);
      expect(result.endsWith('…')).toBe(true);
    });

    it('property: enforceWordLimit never returns more than maxWords words (+ellipsis)', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0), {
            minLength: 0,
            maxLength: 600,
          }),
          fc.integer({ min: 1, max: 300 }),
          (words, maxWords) => {
            const text = words.join(' ');
            const result = enforceWordLimit(text, maxWords);
            const resultWordCount = result
              .replace('…', '')
              .trim()
              .split(/\s+/)
              .filter(Boolean).length;
            expect(resultWordCount).toBeLessThanOrEqual(maxWords);
          }
        ),
        { numRuns: 30 }
      );
    });

    it("processQuery truncates Backboard's answer if it exceeds 1000 words", async () => {
      const overLongAnswer = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ');
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: overLongAnswer,
          citations: [makeCitation()],
          confidenceScore: 0.9,
          status: 'success' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      const result = await engine.processQuery('course-1', validQuery);
      const wordCount = result.answer.replace('…', '').trim().split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(1000);
    });
  });

  // =========================================================
  // Citation completeness (spec section 19)
  // =========================================================
  describe('citation completeness', () => {
    it('isCompleteCitation accepts a fully-populated citation', () => {
      expect(isCompleteCitation(makeCitation())).toBe(true);
    });

    it.each([
      ['empty fileName', makeCitation({ fileName: '' })],
      ['whitespace fileName', makeCitation({ fileName: '   ' })],
      ['zero pageNumber', makeCitation({ pageNumber: 0 })],
      ['negative pageNumber', makeCitation({ pageNumber: -3 })],
      ['non-integer pageNumber', makeCitation({ pageNumber: 4.5 })],
      ['empty sectionHeading', makeCitation({ sectionHeading: '' })],
      ['NaN relevanceScore', makeCitation({ relevanceScore: NaN })],
    ])('rejects citation with %s', (_label, citation) => {
      expect(isCompleteCitation(citation)).toBe(false);
    });

    it('accepts a citation without sourceUrl (optional field)', () => {
      const { sourceUrl, ...withoutUrl } = makeCitation();
      expect(isCompleteCitation(withoutUrl as Citation)).toBe(true);
    });

    it('filterCompleteCitations drops only the invalid entries', () => {
      const citations = [makeCitation(), makeCitation({ fileName: '' }), makeCitation({ pageNumber: 2 })];
      const filtered = filterCompleteCitations(citations);
      expect(filtered).toHaveLength(2);
    });

    it('processQuery filters out incomplete citations from the final response', async () => {
      const backboard = makeBackboardStub({
        query: vi.fn(async () => ({
          answer: 'context',
          citations: [makeCitation(), makeCitation({ sectionHeading: '' })],
          confidenceScore: 0.9,
          status: 'success' as const,
        })),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      const result = await engine.processQuery('course-1', validQuery);
      expect(result.citations).toHaveLength(1);
    });
  });

  // =========================================================
  // Failure handling — never hallucinate
  // =========================================================
  describe('failure handling', () => {
    it('returns retrieval_error when Backboard.query throws', async () => {
      const backboard = makeBackboardStub({
        query: vi.fn(async () => {
          throw new Error('Backboard.io request failed: 503 Service Unavailable');
        }),
      });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      const result = await engine.processQuery('course-1', validQuery);

      expect(result).toEqual({
        answer: '',
        citations: [],
        confidenceScore: 0,
        status: 'retrieval_error',
      });
    });
  });

  // =========================================================
  // Course isolation (spec section 20)
  // =========================================================
  describe('course isolation', () => {
    it('passes the exact courseId through to Backboard on every call', async () => {
      const queryMock = vi.fn(async () => ({
        answer: 'context',
        citations: [makeCitation()],
        confidenceScore: 0.9,
        status: 'success' as const,
      }));
      const backboard = makeBackboardStub({ query: queryMock });
      const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

      await engine.processQuery('course-A', validQuery);
      await engine.processQuery('course-B', validQuery);

      expect(queryMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ courseId: 'course-A' }));
      expect(queryMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ courseId: 'course-B' }));
    });

    it('property: courseId is always forwarded unchanged for arbitrary course IDs', async () => {
      await fc.assert(
        fc.asyncProperty(fc.stringMatching(/^[a-z0-9_-]{3,20}$/), async (courseId) => {
          const queryMock = vi.fn(async () => ({
            answer: 'context',
            citations: [] as Citation[],
            confidenceScore: 0.9,
            status: 'success' as const,
          }));
          const backboard = makeBackboardStub({ query: queryMock });
          const engine = new RAGEngineImpl(backboard, makeKeyManagerStub());

          await engine.processQuery(courseId, validQuery);

          expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({ courseId }));
        }),
        { numRuns: 20 }
      );
    });
  });
});
