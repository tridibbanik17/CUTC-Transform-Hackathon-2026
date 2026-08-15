// ============================================================
// Indexing Orchestrator
// Coordinates document indexing end-to-end:
//   documents (DocumentLink[]) → documentProcessor (local extraction)
//   → indexingOrchestrator (dedup, progress, partial-failure survival)
//   → Backboard.io (chunking, embeddings, vector storage)
//
// This module does NOT parse documents itself (documentProcessor's
// job) and does NOT build a local vector store (Backboard's job) —
// it only sequences the two and tracks state around them.
// ============================================================

import type {
  DocumentLink,
  ExtractedDocument,
  IndexingResult,
  CourseStatus,
  BackboardClient,
  DocumentProcessorAPI,
} from '@/types';
import { backboardClient } from './backboard-client';
import { documentProcessor } from './document-processor';

/** Maximum time a re-index is allowed to run before being abandoned (spec section 28). */
export const MAX_REINDEX_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/** Reported before/after each document is processed. */
export interface IndexingProgress {
  completed: number;
  total: number;
  currentFileName: string | null;
}

export type OnProgressCallback = (progress: IndexingProgress) => void;

/**
 * Thrown when a re-index exceeds MAX_REINDEX_DURATION_MS. The previous
 * index is left untouched — this only means the orchestrator stopped
 * waiting locally, per spec section 28 ("Cancel / Keep previous index /
 * Notify user").
 */
export class ReIndexTimeoutError extends Error {
  constructor(message = `Re-indexing exceeded the ${MAX_REINDEX_DURATION_MS / 60000}-minute limit.`) {
    super(message);
    this.name = 'ReIndexTimeoutError';
  }
}

function emptyIndexingResult(): IndexingResult {
  return { success: true, documentsIndexed: 0, chunksCreated: 0, failures: [] };
}

function mergeIndexingResult(target: IndexingResult, addition: IndexingResult): void {
  target.documentsIndexed += addition.documentsIndexed;
  target.chunksCreated += addition.chunksCreated;
  target.failures.push(...addition.failures);
  if (!addition.success) target.success = false;
}

/** SHA-256 hex digest of a text string, for content hashing pre-extracted text. */
async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function textToExtractedDocument(fileName: string, text: string): ExtractedDocument {
  return {
    fileName,
    fileType: fileName.split('.').pop() || 'txt',
    pages: [{ pageNumber: 1, headings: [], text }],
    totalCharacters: text.length,
  };
}

/**
 * Indexing Orchestrator implementation. Dependencies are injectable
 * (defaulting to the module singletons) purely to keep this testable
 * without mocking module resolution.
 */
export class IndexingOrchestratorImpl {
  constructor(
    private readonly processor: DocumentProcessorAPI = documentProcessor,
    private readonly backboard: BackboardClient = backboardClient
  ) {}

  /**
   * Index a batch of documents for a course. For each document:
   *   1. Compute its content hash.
   *   2. Skip it if Backboard already has it (deduplication).
   *   3. Otherwise extract it locally and send it to Backboard.
   * A failure on one document does not stop the others — partial
   * progress survives (spec section 24). Progress is reported as
   * completed/total both before and after each document.
   */
  async indexDocuments(params: {
    courseId: string;
    apiKey: string;
    documentLinks: DocumentLink[];
    onProgress?: OnProgressCallback;
  }): Promise<IndexingResult> {
    const { courseId, apiKey, documentLinks, onProgress } = params;
    const total = documentLinks.length;
    const aggregate = emptyIndexingResult();

    let completed = 0;

    for (const link of documentLinks) {
      onProgress?.({ completed, total, currentFileName: link.fileName });

      try {
        const contentHash = await this.processor.computeDocumentHash(link);
        const alreadyIndexed = await this.backboard.hasDocument(courseId, apiKey, contentHash);

        if (alreadyIndexed) {
          // Deduplication (spec section 23, step 2): skip re-sending
          // content Backboard already has, but it still counts as
          // "indexed" for summary purposes.
          aggregate.documentsIndexed += 1;
        } else {
          const extracted = await this.processor.fetchAndExtract(link);
          const result = await this.backboard.indexDocument({
            courseId,
            apiKey,
            document: extracted,
            contentHash,
          });
          mergeIndexingResult(aggregate, result);
        }
      } catch (err) {
        aggregate.success = false;
        aggregate.failures.push({
          fileName: link.fileName,
          error: err instanceof Error ? err.message : 'Unknown error during indexing.',
        });
      }

      completed += 1;
      onProgress?.({ completed, total, currentFileName: link.fileName });
    }

    return aggregate;
  }

  /**
   * Re-index a course: extracts the given documents and replaces the
   * course's entire Backboard index with them (spec section 27). The
   * previous index remains queryable until the replace succeeds.
   *
   * If any individual document fails extraction, indexing continues
   * for the rest (same partial-failure principle as indexDocuments);
   * only the successfully-extracted documents are sent to Backboard.
   * If re-indexing takes longer than MAX_REINDEX_DURATION_MS, this
   * throws ReIndexTimeoutError and the previous index is left as-is
   * (spec section 28).
   */
  async reIndex(params: {
    courseId: string;
    apiKey: string;
    documentLinks: DocumentLink[];
    onProgress?: OnProgressCallback;
    timeoutMs?: number;
  }): Promise<IndexingResult> {
    const { courseId, apiKey, documentLinks, onProgress, timeoutMs = MAX_REINDEX_DURATION_MS } = params;
    const total = documentLinks.length;
    const aggregate = emptyIndexingResult();

    const extracted: ExtractedDocument[] = [];
    let completed = 0;

    for (const link of documentLinks) {
      onProgress?.({ completed, total, currentFileName: link.fileName });
      try {
        extracted.push(await this.processor.fetchAndExtract(link));
      } catch (err) {
        aggregate.success = false;
        aggregate.failures.push({
          fileName: link.fileName,
          error: err instanceof Error ? err.message : 'Unknown error during extraction.',
        });
      }
      completed += 1;
      onProgress?.({ completed, total, currentFileName: link.fileName });
    }

    if (extracted.length === 0) {
      // Nothing usable was extracted — don't call Backboard with an
      // empty replace; the previous index is untouched.
      return aggregate;
    }

    const replaceResult = await this.runWithTimeout(
      this.backboard.replaceCourseIndex(courseId, apiKey, extracted),
      timeoutMs
    );

    mergeIndexingResult(aggregate, replaceResult);
    return aggregate;
  }

  /**
   * Index documents whose text has ALREADY been extracted client-side
   * (e.g. browser-uploaded File objects, parsed via the side panel's
   * PDF.js iframe). documentProcessor.fetchAndExtract() only works for
   * network-fetchable DocumentLink URLs — a local File has no such URL,
   * so this method covers that gap while reusing the exact same
   * hash → dedup-check → index → partial-failure/progress logic as
   * indexDocuments(). See the integration report for why this exists
   * alongside (not instead of) indexDocuments().
   */
  async indexExtractedDocuments(params: {
    courseId: string;
    apiKey: string;
    documents: Array<{ fileName: string; text: string }>;
    onProgress?: OnProgressCallback;
  }): Promise<IndexingResult> {
    const { courseId, apiKey, documents, onProgress } = params;
    const total = documents.length;
    const aggregate = emptyIndexingResult();

    let completed = 0;

    for (const doc of documents) {
      onProgress?.({ completed, total, currentFileName: doc.fileName });

      try {
        const contentHash = await hashText(doc.text);
        const alreadyIndexed = await this.backboard.hasDocument(courseId, apiKey, contentHash);

        if (alreadyIndexed) {
          aggregate.documentsIndexed += 1;
        } else {
          const extracted = textToExtractedDocument(doc.fileName, doc.text);
          const result = await this.backboard.indexDocument({
            courseId,
            apiKey,
            document: extracted,
            contentHash,
          });
          mergeIndexingResult(aggregate, result);
        }
      } catch (err) {
        aggregate.success = false;
        aggregate.failures.push({
          fileName: doc.fileName,
          error: err instanceof Error ? err.message : 'Unknown error during indexing.',
        });
      }

      completed += 1;
      onProgress?.({ completed, total, currentFileName: doc.fileName });
    }

    return aggregate;
  }

  /** Thin pass-through so callers can sync course status through the orchestrator. */
  async getCourseStatus(courseId: string, apiKey: string): Promise<CourseStatus> {
    return this.backboard.getCourseStatus(courseId, apiKey);
  }

  /**
   * Races a promise against a timeout. On timeout, rejects with
   * ReIndexTimeoutError — the underlying Backboard call is left to
   * settle on its own; we simply stop waiting for it locally.
   */
  private runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ReIndexTimeoutError()), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }
}

/** Singleton instance for use across the extension. */
export const indexingOrchestrator = new IndexingOrchestratorImpl();
