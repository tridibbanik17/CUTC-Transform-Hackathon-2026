import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  IndexingOrchestratorImpl,
  ReIndexTimeoutError,
  MAX_REINDEX_DURATION_MS,
  type IndexingProgress,
} from '../../src/background/indexing-orchestrator';
import type { BackboardClient, DocumentProcessorAPI, DocumentLink, ExtractedDocument, IndexingResult } from '../../src/types';

function makeLink(overrides: Partial<DocumentLink> = {}): DocumentLink {
  return {
    url: 'https://example.com/doc.pdf',
    fileName: 'doc.pdf',
    fileType: 'pdf',
    ...overrides,
  };
}

function makeExtracted(fileName: string): ExtractedDocument {
  return {
    fileName,
    fileType: 'pdf',
    pages: [{ pageNumber: 1, headings: [], text: 'content' }],
    totalCharacters: 7,
  };
}

function makeProcessorStub(overrides: Partial<DocumentProcessorAPI> = {}): DocumentProcessorAPI {
  return {
    fetchAndExtract: vi.fn(async (link: DocumentLink) => makeExtracted(link.fileName)),
    computeDocumentHash: vi.fn(async (link: DocumentLink) => `hash-${link.fileName}`),
    ...overrides,
  };
}

function makeBackboardStub(overrides: Partial<BackboardClient> = {}): BackboardClient {
  return {
    indexDocument: vi.fn(async () => ({
      success: true,
      documentsIndexed: 1,
      chunksCreated: 3,
      failures: [],
    })),
    hasDocument: vi.fn(async () => false),
    query: vi.fn(),
    getCourseStatus: vi.fn(async () => ({
      status: 'indexed' as const,
      documentCount: 1,
      chunkCount: 3,
    })),
    replaceCourseIndex: vi.fn(async () => ({
      success: true,
      documentsIndexed: 2,
      chunksCreated: 6,
      failures: [],
    })),
    deleteCourse: vi.fn(),
    ...overrides,
  } as unknown as BackboardClient;
}

const courseId = 'course-1';
const apiKey = 'AIzaSyTestKey';

describe('IndexingOrchestratorImpl', () => {
  // =========================================================
  // Basic indexing flow
  // =========================================================
  describe('indexDocuments', () => {
    it('extracts, hashes, and indexes each new document', async () => {
      const processor = makeProcessorStub();
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const links = [makeLink({ fileName: 'a.pdf' }), makeLink({ fileName: 'b.pdf' })];
      const result = await orchestrator.indexDocuments({ courseId, apiKey, documentLinks: links });

      expect(processor.fetchAndExtract).toHaveBeenCalledTimes(2);
      expect(backboard.indexDocument).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.documentsIndexed).toBe(2);
      expect(result.chunksCreated).toBe(6);
      expect(result.failures).toEqual([]);
    });

    it('skips extraction/indexing for documents Backboard already has (deduplication)', async () => {
      const processor = makeProcessorStub();
      const backboard = makeBackboardStub({ hasDocument: vi.fn(async () => true) });
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const links = [makeLink({ fileName: 'already-indexed.pdf' })];
      const result = await orchestrator.indexDocuments({ courseId, apiKey, documentLinks: links });

      expect(processor.fetchAndExtract).not.toHaveBeenCalled();
      expect(backboard.indexDocument).not.toHaveBeenCalled();
      expect(result.documentsIndexed).toBe(1);
    });

    it('computes the hash for every document before checking hasDocument', async () => {
      const processor = makeProcessorStub();
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      await orchestrator.indexDocuments({ courseId, apiKey, documentLinks: [makeLink({ fileName: 'x.pdf' })] });

      expect(processor.computeDocumentHash).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'x.pdf' }));
      expect(backboard.hasDocument).toHaveBeenCalledWith(courseId, apiKey, 'hash-x.pdf');
    });
  });

  // =========================================================
  // Partial failure handling (spec section 24)
  // =========================================================
  describe('partial failure handling', () => {
    it('continues processing remaining documents after one fails, and preserves successful ones', async () => {
      const processor = makeProcessorStub({
        fetchAndExtract: vi.fn(async (link: DocumentLink) => {
          if (link.fileName === 'bad.pdf') throw new Error('corrupt file');
          return makeExtracted(link.fileName);
        }),
      });
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const links = [
        makeLink({ fileName: 'good1.pdf' }),
        makeLink({ fileName: 'bad.pdf' }),
        makeLink({ fileName: 'good2.pdf' }),
      ];
      const result = await orchestrator.indexDocuments({ courseId, apiKey, documentLinks: links });

      expect(result.success).toBe(false);
      expect(result.documentsIndexed).toBe(2); // good1 + good2
      expect(result.failures).toEqual([{ fileName: 'bad.pdf', error: 'corrupt file' }]);
      // both good documents were still sent to Backboard
      expect(backboard.indexDocument).toHaveBeenCalledTimes(2);
    });

    it('records a failure when Backboard.indexDocument itself throws, without stopping the batch', async () => {
      const processor = makeProcessorStub();
      const backboard = makeBackboardStub({
        indexDocument: vi.fn(async (params) => {
          if (params.document.fileName === 'reject-me.pdf') {
            throw new Error('Backboard rejected the document');
          }
          return { success: true, documentsIndexed: 1, chunksCreated: 2, failures: [] };
        }),
      });
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const links = [makeLink({ fileName: 'ok.pdf' }), makeLink({ fileName: 'reject-me.pdf' })];
      const result = await orchestrator.indexDocuments({ courseId, apiKey, documentLinks: links });

      expect(result.documentsIndexed).toBe(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].fileName).toBe('reject-me.pdf');
    });

    it('property: successful documents before/after a failure are always counted, and failures list matches the failing files', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
          async (shouldFailFlags) => {
            const fileNames = shouldFailFlags.map((_, i) => `doc${i}.pdf`);
            const processor = makeProcessorStub({
              fetchAndExtract: vi.fn(async (link: DocumentLink) => {
                const idx = fileNames.indexOf(link.fileName);
                if (shouldFailFlags[idx]) throw new Error('extraction failed');
                return makeExtracted(link.fileName);
              }),
            });
            const backboard = makeBackboardStub();
            const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

            const links = fileNames.map((fileName) => makeLink({ fileName }));
            const result = await orchestrator.indexDocuments({ courseId, apiKey, documentLinks: links });

            const expectedSuccesses = shouldFailFlags.filter((f) => !f).length;
            const expectedFailures = shouldFailFlags.filter((f) => f).length;

            expect(result.documentsIndexed).toBe(expectedSuccesses);
            expect(result.failures).toHaveLength(expectedFailures);
            expect(result.success).toBe(expectedFailures === 0);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  // =========================================================
  // Progress tracking (spec section 23, K/N)
  // =========================================================
  describe('progress tracking', () => {
    it('reports completed/total before and after each document, ending at N/N', async () => {
      const processor = makeProcessorStub();
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const progressEvents: IndexingProgress[] = [];
      const links = [makeLink({ fileName: 'a.pdf' }), makeLink({ fileName: 'b.pdf' }), makeLink({ fileName: 'c.pdf' })];

      await orchestrator.indexDocuments({
        courseId,
        apiKey,
        documentLinks: links,
        onProgress: (p) => progressEvents.push(p),
      });

      expect(progressEvents[0]).toEqual({ completed: 0, total: 3, currentFileName: 'a.pdf' });
      const last = progressEvents[progressEvents.length - 1];
      expect(last).toEqual({ completed: 3, total: 3, currentFileName: 'c.pdf' });
    });

    it('property: completed never exceeds total and is non-decreasing across the callback sequence', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (n) => {
          const processor = makeProcessorStub();
          const backboard = makeBackboardStub();
          const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

          const progressEvents: IndexingProgress[] = [];
          const links = Array.from({ length: n }, (_, i) => makeLink({ fileName: `doc${i}.pdf` }));

          await orchestrator.indexDocuments({
            courseId,
            apiKey,
            documentLinks: links,
            onProgress: (p) => progressEvents.push(p),
          });

          let prev = -1;
          for (const event of progressEvents) {
            expect(event.total).toBe(n);
            expect(event.completed).toBeLessThanOrEqual(n);
            expect(event.completed).toBeGreaterThanOrEqual(prev);
            prev = event.completed;
          }
          expect(progressEvents[progressEvents.length - 1].completed).toBe(n);
        }),
        { numRuns: 15 }
      );
    });
  });

  // =========================================================
  // No local vector store — orchestrator is a thin coordinator
  // =========================================================
  describe('architecture constraints', () => {
    it('never sends empty-content chunks itself — passes ExtractedDocument straight through to Backboard', async () => {
      const extracted = makeExtracted('a.pdf');
      const processor = makeProcessorStub({ fetchAndExtract: vi.fn(async () => extracted) });
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      await orchestrator.indexDocuments({ courseId, apiKey, documentLinks: [makeLink({ fileName: 'a.pdf' })] });

      expect(backboard.indexDocument).toHaveBeenCalledWith(
        expect.objectContaining({ document: extracted, courseId, apiKey })
      );
    });
  });

  // =========================================================
  // indexExtractedDocuments — pre-extracted text (uploaded files)
  // =========================================================
  describe('indexExtractedDocuments', () => {
    it('hashes text, checks dedup, and indexes new pre-extracted documents', async () => {
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(makeProcessorStub(), backboard);

      const result = await orchestrator.indexExtractedDocuments({
        courseId,
        apiKey,
        documents: [{ fileName: 'notes.pdf', text: 'Some extracted text content.' }],
      });

      expect(backboard.hasDocument).toHaveBeenCalledTimes(1);
      expect(backboard.indexDocument).toHaveBeenCalledTimes(1);
      expect(backboard.indexDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          courseId,
          apiKey,
          document: expect.objectContaining({ fileName: 'notes.pdf' }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.documentsIndexed).toBe(1);
    });

    it('skips indexing when Backboard already has the same text hash', async () => {
      const backboard = makeBackboardStub({ hasDocument: vi.fn(async () => true) });
      const orchestrator = new IndexingOrchestratorImpl(makeProcessorStub(), backboard);

      const result = await orchestrator.indexExtractedDocuments({
        courseId,
        apiKey,
        documents: [{ fileName: 'dup.pdf', text: 'duplicate content' }],
      });

      expect(backboard.indexDocument).not.toHaveBeenCalled();
      expect(result.documentsIndexed).toBe(1);
    });

    it('produces the same hash for identical text and different hashes for different text', async () => {
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(makeProcessorStub(), backboard);

      await orchestrator.indexExtractedDocuments({
        courseId,
        apiKey,
        documents: [
          { fileName: 'a.pdf', text: 'identical text' },
          { fileName: 'b.pdf', text: 'identical text' },
          { fileName: 'c.pdf', text: 'different text' },
        ],
      });

      const hashCalls = (backboard.hasDocument as any).mock.calls.map((c: any[]) => c[2]);
      expect(hashCalls[0]).toBe(hashCalls[1]);
      expect(hashCalls[0]).not.toBe(hashCalls[2]);
    });

    it('continues past a failure in one document and still indexes the rest', async () => {
      const backboard = makeBackboardStub({
        indexDocument: vi.fn(async (p) => {
          if (p.document.fileName === 'bad.pdf') throw new Error('rejected');
          return { success: true, documentsIndexed: 1, chunksCreated: 2, failures: [] };
        }),
      });
      const orchestrator = new IndexingOrchestratorImpl(makeProcessorStub(), backboard);

      const result = await orchestrator.indexExtractedDocuments({
        courseId,
        apiKey,
        documents: [
          { fileName: 'good.pdf', text: 'good content' },
          { fileName: 'bad.pdf', text: 'bad content' },
        ],
      });

      expect(result.documentsIndexed).toBe(1);
      expect(result.failures).toEqual([{ fileName: 'bad.pdf', error: 'rejected' }]);
    });
  });

  // =========================================================
  // Re-indexing (spec section 27)
  // =========================================================
  describe('reIndex', () => {
    it('extracts all documents then replaces the course index in one Backboard call', async () => {
      const processor = makeProcessorStub();
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const links = [makeLink({ fileName: 'a.pdf' }), makeLink({ fileName: 'b.pdf' })];
      const result = await orchestrator.reIndex({ courseId, apiKey, documentLinks: links });

      expect(processor.fetchAndExtract).toHaveBeenCalledTimes(2);
      expect(backboard.replaceCourseIndex).toHaveBeenCalledTimes(1);
      expect(backboard.replaceCourseIndex).toHaveBeenCalledWith(
        courseId,
        apiKey,
        expect.arrayContaining([expect.objectContaining({ fileName: 'a.pdf' }), expect.objectContaining({ fileName: 'b.pdf' })])
      );
      expect(result.success).toBe(true);
      expect(result.documentsIndexed).toBe(2);
    });

    it('excludes documents that fail extraction from the replace call, but still reports them as failures', async () => {
      const processor = makeProcessorStub({
        fetchAndExtract: vi.fn(async (link: DocumentLink) => {
          if (link.fileName === 'bad.pdf') throw new Error('unreadable');
          return makeExtracted(link.fileName);
        }),
      });
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const links = [makeLink({ fileName: 'good.pdf' }), makeLink({ fileName: 'bad.pdf' })];
      const result = await orchestrator.reIndex({ courseId, apiKey, documentLinks: links });

      expect(backboard.replaceCourseIndex).toHaveBeenCalledWith(
        courseId,
        apiKey,
        [expect.objectContaining({ fileName: 'good.pdf' })]
      );
      expect(result.failures).toEqual([{ fileName: 'bad.pdf', error: 'unreadable' }]);
    });

    it('does not call Backboard at all if every document fails extraction, leaving the previous index untouched', async () => {
      const processor = makeProcessorStub({
        fetchAndExtract: vi.fn(async () => {
          throw new Error('all unreadable');
        }),
      });
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const result = await orchestrator.reIndex({ courseId, apiKey, documentLinks: [makeLink()] });

      expect(backboard.replaceCourseIndex).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.failures).toHaveLength(1);
    });
  });

  // =========================================================
  // Re-index timeout (spec section 28)
  // =========================================================
  describe('reIndex timeout', () => {
    it('rejects with ReIndexTimeoutError if replaceCourseIndex takes longer than the timeout', async () => {
      vi.useFakeTimers();
      const processor = makeProcessorStub();
      const backboard = makeBackboardStub({
        replaceCourseIndex: vi.fn(() => new Promise<IndexingResult>(() => {})), // never resolves
      });
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const promise = orchestrator.reIndex({
        courseId,
        apiKey,
        documentLinks: [makeLink()],
        timeoutMs: 1000,
      });
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).rejects.toThrow(ReIndexTimeoutError);
      vi.useRealTimers();
    });

    it('resolves normally when replaceCourseIndex finishes before the timeout', async () => {
      vi.useFakeTimers();
      const processor = makeProcessorStub();
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(processor, backboard);

      const promise = orchestrator.reIndex({
        courseId,
        apiKey,
        documentLinks: [makeLink()],
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.success).toBe(true);
      vi.useRealTimers();
    });

    it('defaults to the 15-minute MAX_REINDEX_DURATION_MS when no timeoutMs is given', () => {
      expect(MAX_REINDEX_DURATION_MS).toBe(15 * 60 * 1000);
    });
  });

  // =========================================================
  // Course status pass-through (spec section 25)
  // =========================================================
  describe('getCourseStatus', () => {
    it('delegates to backboardClient.getCourseStatus', async () => {
      const backboard = makeBackboardStub();
      const orchestrator = new IndexingOrchestratorImpl(makeProcessorStub(), backboard);

      const status = await orchestrator.getCourseStatus(courseId, apiKey);

      expect(backboard.getCourseStatus).toHaveBeenCalledWith(courseId, apiKey);
      expect(status.status).toBe('indexed');
    });
  });
});
