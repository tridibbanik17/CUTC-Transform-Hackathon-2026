import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { BackboardClientImpl, BackboardApiError } from '../../src/background/backboard-client';
import type { ExtractedDocument, RAGResponse, CourseStatus, IndexingResult } from '../../src/types';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

// Use alphanumeric generators to avoid URL encoding issues
const courseIdArb = fc.stringMatching(/^[a-z0-9]{3,20}$/);

const hashArb = fc.stringMatching(/^[a-f0-9]{64}$/);

describe('Backboard.io Client - Property Tests', () => {
  let client: BackboardClientImpl;
  const apiKey = 'test-api-key-123';

  beforeEach(() => {
    client = new BackboardClientImpl('https://api.backboard.io/v1');
    vi.clearAllMocks();
  });

  // =========================================================
  // Property 14: Course context isolation
  // Validates: Requirements 8.1, 8.3
  // =========================================================
  describe('Property 14: Course context isolation', () => {
    it('queries for different courses hit different API endpoints', async () => {
      await fc.assert(
        fc.asyncProperty(courseIdArb, courseIdArb, async (courseIdA, courseIdB) => {
          if (courseIdA === courseIdB) return;
          vi.clearAllMocks();

          mockFetch
            .mockResolvedValueOnce(mockJsonResponse({
              answer: 'A', citations: [], confidenceScore: 0.8, status: 'success',
            }))
            .mockResolvedValueOnce(mockJsonResponse({
              answer: 'B', citations: [], confidenceScore: 0.7, status: 'success',
            }));

          await client.query({ courseId: courseIdA, apiKey, queryText: 'test' });
          await client.query({ courseId: courseIdB, apiKey, queryText: 'test' });

          const urlA = mockFetch.mock.calls[0][0] as string;
          const urlB = mockFetch.mock.calls[1][0] as string;

          // URLs must differ — different course paths
          expect(urlA).not.toBe(urlB);
          expect(urlA).toContain(`/courses/${courseIdA}/`);
          expect(urlB).toContain(`/courses/${courseIdB}/`);
        }),
        { numRuns: 20 }
      );
    });

    it('indexDocument targets the correct course endpoint', async () => {
      await fc.assert(
        fc.asyncProperty(courseIdArb, async (courseId) => {
          vi.clearAllMocks();

          mockFetch.mockResolvedValueOnce(mockJsonResponse({
            success: true, documentsIndexed: 1, chunksCreated: 5, failures: [],
          }));

          await client.indexDocument({
            courseId,
            apiKey,
            document: {
              fileName: 'test.pdf', fileType: 'pdf',
              pages: [{ pageNumber: 1, headings: ['H1'], text: 'Content' }],
              totalCharacters: 7,
            },
            contentHash: 'abc123',
          });

          const url = mockFetch.mock.calls[0][0] as string;
          expect(url).toContain(`/courses/${courseId}/documents`);
        }),
        { numRuns: 20 }
      );
    });
  });

  // =========================================================
  // Property 20: Course data deletion completeness
  // Validates: Requirements 11.6
  // =========================================================
  describe('Property 20: Course data deletion completeness', () => {
    it('after deletion, status shows not_indexed and hasDocument returns false', async () => {
      await fc.assert(
        fc.asyncProperty(
          courseIdArb,
          fc.array(hashArb, { minLength: 1, maxLength: 3 }),
          async (courseId, hashes) => {
            vi.clearAllMocks();

            // Mock delete
            mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 200));
            await client.deleteCourse(courseId, apiKey);

            const deleteUrl = mockFetch.mock.calls[0][0] as string;
            const deleteMethod = (mockFetch.mock.calls[0][1] as RequestInit).method;
            expect(deleteUrl).toContain(`/courses/${courseId}`);
            expect(deleteMethod).toBe('DELETE');

            // Mock getCourseStatus after deletion
            mockFetch.mockResolvedValueOnce(mockJsonResponse({
              status: 'not_indexed', documentCount: 0, chunkCount: 0,
            }));
            const status = await client.getCourseStatus(courseId, apiKey);
            expect(status.status).toBe('not_indexed');
            expect(status.documentCount).toBe(0);

            // Mock hasDocument after deletion
            for (const hash of hashes) {
              mockFetch.mockResolvedValueOnce(mockJsonResponse({ exists: false }));
              const exists = await client.hasDocument(courseId, apiKey, hash);
              expect(exists).toBe(false);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  // =========================================================
  // Property 21: Chunk size and non-empty constraint
  // Validates: Requirements 11.3
  // =========================================================
  describe('Property 21: Chunk size and non-empty constraint', () => {
    it('indexDocument transmits non-empty page text and correct totalCharacters', async () => {
      const pageArb = fc.record({
        pageNumber: fc.integer({ min: 1, max: 500 }),
        headings: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 3 }),
        text: fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
      });

      await fc.assert(
        fc.asyncProperty(
          courseIdArb,
          fc.array(pageArb, { minLength: 1, maxLength: 5 }),
          async (courseId, pages) => {
            vi.clearAllMocks();

            const totalCharacters = pages.reduce((sum, p) => sum + p.text.length, 0);
            const doc: ExtractedDocument = {
              fileName: 'test.pdf', fileType: 'pdf', pages, totalCharacters,
            };

            mockFetch.mockResolvedValueOnce(mockJsonResponse({
              success: true, documentsIndexed: 1, chunksCreated: pages.length, failures: [],
            }));

            await client.indexDocument({ courseId, apiKey, document: doc, contentHash: 'h' });

            const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
            const sentDoc = body.document;

            expect(sentDoc.pages.length).toBeGreaterThan(0);
            for (const page of sentDoc.pages) {
              expect(page.text.length).toBeGreaterThan(0);
            }

            const actualTotal = sentDoc.pages.reduce(
              (sum: number, p: { text: string }) => sum + p.text.length, 0
            );
            expect(sentDoc.totalCharacters).toBe(actualTotal);
          }
        ),
        { numRuns: 25 }
      );
    });
  });

  // =========================================================
  // Retry behavior tests
  // =========================================================
  describe('Retry behavior', () => {
    it('retries on 500/503 up to 2 times then throws', async () => {
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse({}, 503))
        .mockResolvedValueOnce(mockJsonResponse({}, 503))
        .mockResolvedValueOnce(mockJsonResponse({}, 503));

      await expect(
        client.getCourseStatus('course-1', apiKey)
      ).rejects.toThrow(BackboardApiError);

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('fails immediately on 400/401/403 without retrying', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 401));

      await expect(
        client.query({ courseId: 'course-1', apiKey, queryText: 'test' })
      ).rejects.toThrow(BackboardApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('succeeds on retry after transient server error', async () => {
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse({}, 500))
        .mockResolvedValueOnce(mockJsonResponse({
          status: 'indexed', documentCount: 5, chunkCount: 42, lastIndexedAt: '2026-08-10T00:00:00Z',
        }));

      const result = await client.getCourseStatus('course-1', apiKey);
      expect(result.status).toBe('indexed');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws immediately on 429 without retrying', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 429));

      await expect(
        client.query({ courseId: 'course-1', apiKey, queryText: 'test' })
      ).rejects.toThrow(BackboardApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
