# Implementation Plan: LMS RAG Browser Extension

## Overview

This plan implements a Chrome Manifest V3 browser extension that integrates a RAG AI agent into university learning management systems via a pluggable Platform_Adapter architecture. The extension uses Google's Gemini API free tier for both embedding generation (gemini-embedding-2, 768-dimensional vectors) and answer synthesis (gemini-2.5-flash with multi-model fallback chain). The implementation proceeds from project scaffolding and platform abstraction layer, through the D2L Brightspace adapter and content extraction pipeline, to the query engine and React-based side panel UI — wiring all components together at each stage so nothing is orphaned.

## Tasks

- [ ] 1. Project scaffolding and core interfaces
  - [ ] 1.1 Initialize Chrome Manifest V3 project structure
    - Create directory layout: `src/platform/`, `src/platform/adapters/`, `src/content-script/`, `src/background/`, `src/side-panel/`, `src/shared/`, `tests/property/`, `tests/unit/`, `tests/integration/`
    - Create `manifest.json` with Manifest V3 configuration (side_panel, permissions for activeTab, storage, scripting)
    - Set up `tsconfig.json`, `package.json` with TypeScript, React, Vite/webpack bundler
    - Install dependencies: react, react-dom, pdf.js, fast-check, vitest, @google/generative-ai
    - _Requirements: 9.2, 13.1_

  - [ ] 1.2 Define core TypeScript interfaces and types
    - Create `src/types/index.ts` with all shared interfaces: `CourseMetadata`, `DocumentLink`, `ExtractedDocument`, `PageContent`, `DocumentChunk`, `EmbeddingResult`, `StoredVector`, `ChunkMetadata`, `SearchResult`, `Citation`, `CitationMetadata`, `RAGResponse`, `CourseRecord`, `DocumentRecord`, `HistoryEntry`, `PreferenceRecord`
    - Create `src/types/messages.ts` with message types for communication between service worker, content script, and side panel
    - Define `ModelFallbackChain` interface with ordered model list, exhausted behavior config, and error routing logic
    - _Requirements: 1.4, 3.2, 4.1, 5.1, 13.4, 13.5_

  - [ ] 1.3 Set up IndexedDB schema and database initialization
    - Create `src/background/db.ts` with database creation for `lms-rag-vectors` (object stores: vectors, courses, documents) and `lms-rag-session` (object stores: history, preferences, adapters)
    - Implement schema versioning and upgrade logic
    - Define indexes: `courseId` on vectors, `courseId` on documents, `courseId+sessionId` on history, `platform` on courses
    - _Requirements: 11.1, 8.1_

- [ ] 2. Platform adapter layer and D2L Brightspace adapter
  - [ ] 2.1 Implement PlatformAdapter interface and AdapterRegistry
    - Create `src/platform/adapter.ts` defining the `PlatformAdapter` interface with: `name`, `urlPatterns`, `priority`, `matchesUrl()`, `isCoursePage()`, `extractCourseId()`, `extractCourseName()`, `getDocumentLinks()`, `buildCitationUrl()`
    - Create `src/platform/registry.ts` implementing `AdapterRegistry` with: `register()`, `detectPlatform()`, `getActivePlatform()`, `getRegisteredPlatforms()`
    - Registry evaluates adapters in priority order (lowest number = highest priority) and activates the first matching adapter
    - Registry returns `null` when no adapter matches the current URL
    - _Requirements: 12.1, 12.2, 12.5_

  - [ ] 2.2 Implement D2L Brightspace adapter
    - Create `src/platform/adapters/d2l-brightspace.ts` implementing `PlatformAdapter`
    - URL patterns: `^https://[^/]*\.brightspace\.com/` (hosted) and `^https://[^/]*/d2l/` (self-hosted like Avenue to Learn, Waterloo LEARN)
    - Implement `matchesUrl()` to detect D2L URLs regardless of institutional branding
    - Implement `isCoursePage()` to distinguish course pages from login/dashboard pages
    - Implement `extractCourseId()` to parse course ID from D2L URL structure
    - Implement `extractCourseName()` to extract course name from page header DOM
    - Implement `getDocumentLinks()` to enumerate course materials from D2L content pages
    - Implement `buildCitationUrl()` to construct D2L-specific navigation URLs for citations
    - Set priority to 1
    - _Requirements: 12.3, 12.4_

  - [ ] 2.3 Register D2L adapter and wire platform detection into content script
    - Create `src/platform/index.ts` that instantiates the AdapterRegistry and registers the D2L Brightspace adapter
    - Wire the registry into the content script so on page load, it calls `detectPlatform(url)` to determine the active adapter
    - Expose the active adapter to other components via message passing to the service worker
    - _Requirements: 12.2, 12.5_

  - [ ]* 2.4 Write property tests for adapter registry priority-based selection
    - **Property 24: Priority-based adapter selection**
    - **Validates: Requirements 12.2, 12.5**
    - Use fast-check to generate sets of mock adapters with distinct priorities and random URLs
    - Verify the registry activates the adapter with the lowest priority number whose URL pattern matches
    - Verify registry returns null when no adapter matches
    - Verify registering additional adapters does not alter matching behavior for previously registered adapters

  - [ ]* 2.5 Write property tests for D2L Brightspace adapter URL recognition
    - **Property 25: D2L Brightspace adapter URL recognition**
    - **Validates: Requirements 12.3**
    - Use fast-check to generate URLs with D2L patterns (*.brightspace.com domains, /d2l/ paths with various subdomains and institutional branding)
    - Verify all D2L-patterned URLs are matched by the adapter
    - Verify non-D2L URLs (Canvas, Moodle, generic websites) are not matched

- [ ] 3. Content scraper using platform adapter
  - [ ] 3.1 Implement content scraper delegating to active platform adapter
    - Create `src/content-script/scraper.ts` implementing `ScraperAPI`
    - `getCourseMetadata()` delegates to the active adapter's `extractCourseId()` and `extractCourseName()` and includes `platform` field from adapter's `name`
    - `getDocumentLinks()` delegates to the active adapter's `getDocumentLinks()`, then filters to supported file types (PDF, PPTX, HTML, PNG, JPG, JPEG)
    - `isSupportedCoursePage()` calls active adapter's `isCoursePage()`
    - `getActivePlatformName()` returns the name of the active adapter or null
    - Return `null` for pages where no adapter is active
    - _Requirements: 1.1, 7.5, 12.1, 12.2_

  - [ ] 3.2 Implement document link discovery with supported type filtering
    - Extend scraper to filter `DocumentLink[]` from the adapter, keeping only supported types (PDF, PPTX, HTML, PNG, JPG, JPEG)
    - Extract file metadata (name, size, last modified when available from adapter)
    - Skip unsupported formats silently; they are simply excluded from the returned list
    - _Requirements: 1.1, 1.3, 1.6_

  - [ ] 3.3 Implement document text extraction (PDF, PPTX, HTML)
    - Create `src/background/document-processor.ts` implementing `DocumentProcessorAPI`
    - Implement PDF extraction using PDF.js: fetch document, extract text per page with page numbers and headings
    - Implement PPTX extraction: parse ZIP, extract XML slide text with slide numbers as page numbers
    - Implement HTML extraction: parse DOM content with heading detection
    - Enforce 50MB file size limit; skip documents exceeding the limit and emit a notification with the file name and size limit info
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [ ] 3.4 Implement text chunking algorithm
    - Add chunking logic to `src/background/document-processor.ts`
    - Split text into sentences using regex (`/[.!?]\s+/`)
    - Accumulate sentences into chunks of 200–1000 tokens (1 token ≈ 4 characters)
    - Never split a sentence across two chunks
    - Attach metadata: fileName, pageNumber, nearest heading
    - Generate SHA-256 content hash for deduplication
    - _Requirements: 3.1, 1.4, 1.6_

  - [ ]* 3.5 Write property tests for document chunking
    - **Property 4: Chunking respects token bounds and sentence integrity**
    - **Validates: Requirements 3.1**
    - Use fast-check to generate random multi-sentence texts and verify all chunks are 200–1000 tokens with no split sentences

  - [ ]* 3.6 Write property tests for supported document type filtering
    - **Property 1: Supported document type filtering**
    - **Validates: Requirements 1.1, 1.3**
    - Use fast-check to generate arrays of document links with mixed file types and verify only supported types are returned

  - [ ]* 3.7 Write property tests for metadata preservation
    - **Property 2: Metadata preservation through chunking**
    - **Validates: Requirements 1.4, 3.2**
    - Verify every chunk retains correct source file name, page number, and section heading

  - [ ]* 3.8 Write property tests for document deduplication
    - **Property 3: Document deduplication via content hash**
    - **Validates: Requirements 1.6**
    - Verify that re-presenting an unchanged document results in no re-extraction

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Embedding service and vector store (Gemini API)
  - [ ] 5.1 Implement embedding service with Gemini API
    - Create `src/background/embedding-service.ts` implementing `EmbeddingServiceAPI`
    - Call Gemini `gemini-embedding-2` model to generate 768-dimensional embeddings for text chunks
    - Use the bundled Gemini API free-tier key (no user configuration needed)
    - Filter out empty or whitespace-only chunks before transmission to external API
    - Implement `embedQuery` for single query embedding
    - Implement batch `embedChunks` with chunked API calls to stay within rate limits
    - Implement retry logic: max 2 retries with exponential backoff (1s, 3s) for retryable statuses (500, 502, 503, 504); on HTTP 429, do not retry — surface to caller for fallback handling
    - On HTTP 400/401/403, fail immediately without retry
    - _Requirements: 3.2, 11.2, 11.3, 11.7, 13.1, 13.2_

  - [ ] 5.2 Implement vector store with cosine similarity search
    - Create `src/background/vector-store.ts` implementing `VectorStoreAPI`
    - Store 768-dimensional Float32Array vectors in IndexedDB `vectors` object store with course isolation
    - Implement cosine similarity function for Float32Array vectors
    - Implement `search()`: load all vectors for courseId, compute similarity, return top-K sorted descending
    - Implement `getCourseStatus`, `getCourseStats`, `getStorageUsage`, `hasDocument`
    - Implement `deleteCourse`: remove all vectors, document records, and course record for a courseId
    - Implement `replaceCourseIndex`: atomic replacement for re-indexing
    - _Requirements: 4.1, 8.1, 8.3, 8.4, 10.4, 11.6_

  - [ ] 5.3 Implement storage limit enforcement
    - Add storage usage tracking to vector store (estimate byte size of stored vectors + metadata)
    - Enforce 200MB per-course limit: reject new vectors when limit would be exceeded
    - Return current usage via `getStorageUsage()`
    - _Requirements: 10.4, 10.5_

  - [ ]* 5.4 Write property tests for top-K retrieval
    - **Property 8: Top-K retrieval correctness**
    - **Validates: Requirements 4.1**
    - Generate random vector stores and queries; verify returned results are exactly the 5 highest cosine similarity scores in descending order

  - [ ]* 5.5 Write property tests for course context isolation
    - **Property 14: Course context isolation**
    - **Validates: Requirements 8.1, 8.3**
    - Generate vectors for two courses; verify searching one course never returns chunks from the other

  - [ ]* 5.6 Write property tests for storage limit enforcement
    - **Property 20: Storage limit enforcement**
    - **Validates: Requirements 10.4, 10.5**
    - Verify that once 200MB limit is reached, further indexing is prevented

  - [ ]* 5.7 Write property tests for course data deletion
    - **Property 21: Course data deletion completeness**
    - **Validates: Requirements 11.6**
    - After deletion, verify zero vectors, zero document records, zero course records for the course

  - [ ]* 5.8 Write property tests for chunk size on API transmission
    - **Property 23: Chunk size constraint on API transmission**
    - **Validates: Requirements 11.3**
    - Verify no text chunk sent to Gemini embedding API exceeds 1000 tokens

- [ ] 6. RAG engine, query processing, and model fallback chain
  - [ ] 6.1 Implement model fallback chain service
    - Create `src/background/model-fallback.ts` implementing the `ModelFallbackChain` interface
    - Define ordered model list: `gemini-2.5-flash` (primary) → `gemini-3.5-flash-lite` (first fallback) → `gemini-2.5-flash-lite` (second fallback)
    - Implement error routing: HTTP 429 → advance to next model immediately; HTTP 500/503 → retry same model up to 2× with exponential backoff (1s, 3s) then advance; HTTP 400/401/403 → fail immediately, no retry or advance
    - Implement graceful degradation on full chain exhaustion: halt all cloud API calls, emit "daily limit reached" notification event, preserve local vector search functionality
    - Log which model successfully handled each request for debugging (not exposed to user)
    - _Requirements: 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

  - [ ] 6.2 Implement RAG engine query processing
    - Create `src/background/rag-engine.ts` implementing `RAGEngineAPI`
    - Implement `processQuery`: embed query via Gemini → search vector store (top 5) → evaluate confidence → generate answer or return status
    - If no chunk scores ≥ 0.4: return `{ status: 'insufficient_information', answer: '', citations: [] }`
    - If highest score ≥ 0.4 but < 0.6: return `{ status: 'low_confidence', ... }` with answer and warning
    - If highest score ≥ 0.6: return `{ status: 'success', ... }` with answer and citations
    - If Vector_Store returns zero chunks due to retrieval failure: return `{ status: 'retrieval_error', ... }` with error message
    - Build citation `sourceUrl` using the active Platform_Adapter's `buildCitationUrl()`
    - _Requirements: 4.1, 5.5, 6.1, 6.2, 6.3, 6.4_

  - [ ] 6.3 Implement LLM answer generation with Gemini API and fallback
    - Add answer generation to RAG engine using Gemini API with `gemini-2.5-flash` as primary model
    - Route all generation requests through the model fallback chain service
    - Construct system prompt constraining answers to retrieved context only, max 300 words, markdown formatted
    - Include retrieved chunk texts as context in the user message
    - Parse response and build citations from chunk metadata
    - On fallback chain exhaustion, return graceful degradation status to UI
    - _Requirements: 4.2, 4.4, 6.1, 5.1, 5.4, 13.3, 13.4, 13.5, 13.6_

  - [ ] 6.4 Implement query input validation
    - Create `src/shared/validation.ts`
    - Reject empty, whitespace-only, or < 3 character queries
    - Enforce 500-character maximum length
    - Return validation error messages
    - _Requirements: 4.6, 7.2, 7.6_

  - [ ]* 6.5 Write property tests for fallback chain advancement order
    - **Property 27: Fallback chain advancement order**
    - **Validates: Requirements 13.4, 13.5, 13.7**
    - Use fast-check to simulate sequences of 429 responses and verify models are attempted in exact order: `gemini-2.5-flash` → `gemini-3.5-flash-lite` → `gemini-2.5-flash-lite`, never skipping or reversing

  - [ ]* 6.6 Write property tests for fallback chain exhaustion graceful degradation
    - **Property 26: Fallback chain exhaustion triggers graceful degradation**
    - **Validates: Requirements 13.6**
    - Use fast-check to simulate all models returning 429; verify cloud calls are halted, "daily limit reached" notification is emitted, and local vector search remains functional

  - [ ]* 6.7 Write property tests for API retry and fallback behavior
    - **Property 22: API retry and fallback behavior**
    - **Validates: Requirements 10.7, 13.4, 13.5, 13.8**
    - Simulate 500/503 errors and verify at most 2 retries with exponential backoff before advancing to next model; simulate 429 and verify immediate advancement without retry

  - [ ]* 6.8 Write property tests for confidence thresholds
    - **Property 12: Confidence threshold — insufficient information**
    - **Validates: Requirements 5.5, 6.3**
    - Verify that when no chunk scores ≥ 0.4, status is "insufficient_information" with empty answer

  - [ ]* 6.9 Write property tests for low confidence warning
    - **Property 13: Confidence threshold — low confidence warning**
    - **Validates: Requirements 6.2**
    - Verify that when highest score is ≥ 0.4 but < 0.6, status is "low_confidence"

  - [ ]* 6.10 Write property tests for answer word count
    - **Property 9: Answer word count constraint**
    - **Validates: Requirements 4.2**
    - Verify generated answers never exceed 300 words

  - [ ]* 6.11 Write property tests for citation completeness
    - **Property 11: Citation completeness**
    - **Validates: Requirements 5.1**
    - Verify every citation has non-empty document name, valid page number, and section heading

  - [ ]* 6.12 Write property tests for query validation
    - **Property 10: Invalid query rejection**
    - **Validates: Requirements 4.6, 7.6**
    - Generate empty, whitespace-only, and < 3 char strings; verify all are rejected

  - [ ]* 6.13 Write property tests for query length enforcement
    - **Property 16: Query input length enforcement**
    - **Validates: Requirements 7.2**
    - Generate strings > 500 characters; verify they are rejected

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Indexing orchestration and progress tracking
  - [ ] 8.1 Implement indexing orchestrator in service worker
    - Create `src/background/indexing-orchestrator.ts`
    - Coordinate full pipeline: receive document links from scraper (via adapter) → check deduplication → extract text → chunk → embed via Gemini → store
    - Track progress per document, emit progress events (K/N percentage)
    - Handle partial failures: skip failed documents from any indexing-related component (Document_Indexer, Vector_Store, or embedding service), preserve successful ones, continue processing
    - Update course status: 'not_indexed' → 'indexing' → 'indexed'
    - Store `platform` field in course record from the active adapter's name
    - Generate indexing summary (total documents, total chunks)
    - _Requirements: 1.5, 1.6, 3.3, 3.4, 3.5, 10.1, 10.6_

  - [ ] 8.2 Implement re-indexing with atomic replacement
    - Add re-indexing flow: build new index in temporary storage → on success replace old index → on failure retain old index unchanged
    - Ensure existing data remains queryable during re-indexing
    - _Requirements: 8.4, 8.6_

  - [ ]* 8.3 Write property tests for progress indicator accuracy
    - **Property 5: Progress indicator accuracy**
    - **Validates: Requirements 3.3**
    - Verify that after K of N documents complete, progress equals K/N

  - [ ]* 8.4 Write property tests for failure resilience
    - **Property 6: Failure resilience preserves partial progress**
    - **Validates: Requirements 1.5, 3.4, 10.6**
    - Simulate failures at position K; verify documents 1..K-1 remain indexed

  - [ ]* 8.5 Write property tests for indexing summary accuracy
    - **Property 7: Indexing summary accuracy**
    - **Validates: Requirements 3.5**
    - Verify summary counts match actual stored documents and chunks

  - [ ]* 8.6 Write property tests for atomic re-indexing
    - **Property 15: Atomic re-indexing with rollback**
    - **Validates: Requirements 8.4, 8.6**
    - Simulate re-indexing failure; verify old index is unchanged. Simulate success; verify new index replaces old.

- [ ] 9. Side panel UI implementation
  - [ ] 9.1 Create React side panel shell with routing
    - Create `src/side-panel/index.tsx` entry point with React root
    - Create `src/side-panel/App.tsx` with component hierarchy: Header, IndexingPanel, QueryPanel, OnboardingOverlay, PrivacyNotice, NotificationArea
    - Set up side panel HTML page referenced in manifest.json
    - Implement Chrome Side Panel API registration in service worker
    - _Requirements: 7.1, 7.3_

  - [ ] 9.2 Implement Header component with course detection, platform indicator, and status
    - Create `src/side-panel/components/Header.tsx`
    - Display current course name (received from content script via active adapter)
    - Show platform indicator displaying which LMS platform is currently detected (e.g., "D2L Brightspace") using `getActivePlatformName()`
    - Show indexing status indicator: not indexed (gray), indexing (animated), indexed (green)
    - Detect pages with no active adapter and display guidance message to navigate to a supported LMS
    - _Requirements: 7.3, 7.4, 7.5, 12.6_

  - [ ] 9.3 Implement IndexingPanel with progress and controls
    - Create `src/side-panel/components/IndexingPanel.tsx`
    - Show progress bar with percentage during indexing
    - Provide "Index Course" button (single-click action) and "Re-index" button
    - Display indexing summary on completion (document count, chunk count)
    - Show storage limit notification when 200MB reached
    - _Requirements: 3.3, 3.5, 9.4, 10.5_

  - [ ] 9.4 Implement QueryPanel with input, submission, and answer display
    - Create `src/side-panel/components/QueryPanel.tsx`
    - Text input field with 500-character max length, submit button
    - Client-side validation: reject empty/whitespace/< 3 char queries inline
    - Scrollable answer history area
    - Disable query input when no active platform adapter or when no course context
    - _Requirements: 7.2, 7.5, 7.6, 4.6, 8.7_

  - [ ] 9.5 Implement AnswerCard with markdown rendering, confidence, and citations
    - Create `src/side-panel/components/AnswerCard.tsx`
    - Render answer text with markdown (paragraphs, bullet points) using a lightweight markdown renderer
    - Display confidence score badge
    - Show low-confidence warning when status is "low_confidence"
    - Show "insufficient information" message when status is "insufficient_information"
    - Render citation list with document name, page number, section heading
    - Make citations clickable — navigate via Platform_Adapter's `buildCitationUrl()` (or show "unavailable" message if source is inaccessible)
    - _Requirements: 4.4, 5.1, 5.2, 5.3, 6.2, 6.4_

  - [ ] 9.6 Implement OnboardingOverlay and prompt management
    - Create `src/side-panel/components/OnboardingOverlay.tsx`
    - Display 3-step onboarding guide on first install (max 1 illustration + 2 sentences per step)
    - Display indexing prompt on first visit to an un-indexed course (only after successful Course_Context creation)
    - Persist dismissed state in IndexedDB preferences store only after prompts are actually displayed
    - Never re-show dismissed prompts
    - Provide manual "Index" option in panel for any unindexed course regardless of prompt history
    - _Requirements: 9.1, 9.3, 9.5, 9.6_

  - [ ] 9.7 Implement PrivacyNotice for Gemini API data transmission
    - Create `src/side-panel/components/PrivacyNotice.tsx`
    - Display first-time-in-session notice before sending data to Google's Gemini API servers
    - Inform user that text chunks and queries are sent to Google for embedding and generation processing
    - Note that under the Gemini free tier, content may be used by Google to improve products per their API terms
    - Track notice acknowledgment in session storage (resets each session)
    - _Requirements: 11.2, 11.3, 11.5_

  - [ ] 9.8 Implement session history persistence
    - Create `src/side-panel/hooks/useSessionHistory.ts`
    - Store query/answer pairs in IndexedDB `history` object store keyed by courseId + sessionId
    - Restore history when extension is reopened within same browser session
    - _Requirements: 7.7_

  - [ ] 9.9 Implement notification area for errors, warnings, and rate limits
    - Create `src/side-panel/components/NotificationArea.tsx`
    - Display extraction failures, unsupported format notices, API errors, storage limit warnings, platform adapter errors
    - Display "daily limit reached" notification when model fallback chain is fully exhausted
    - Show platform-specific error messages when adapter encounters errors during page detection
    - Auto-dismiss after timeout or allow manual close
    - _Requirements: 1.3, 1.5, 3.4, 10.5, 12.7, 13.6_

  - [ ]* 9.10 Write property tests for unsupported page detection
    - **Property 17: Unsupported page detection**
    - **Validates: Requirements 7.5, 12.2**
    - Generate URLs that don't match any registered adapter's patterns; verify query input is disabled

  - [ ]* 9.11 Write property tests for session history persistence
    - **Property 18: Session history persistence**
    - **Validates: Requirements 7.7**
    - Simulate sequence of queries, close/reopen, verify complete history retained

  - [ ]* 9.12 Write property tests for dismissed prompt persistence
    - **Property 19: Dismissed prompt persistence**
    - **Validates: Requirements 9.5**
    - Dismiss prompts and verify they are never shown again across sessions

- [ ] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Service worker message routing and integration wiring
  - [ ] 11.1 Implement service worker message handler
    - Create `src/background/service-worker.ts`
    - Register Chrome side panel on extension install
    - Route messages between content script, side panel, and background modules
    - Handle message types: `GET_COURSE_INFO`, `START_INDEXING`, `PROCESS_QUERY`, `GET_INDEX_STATUS`, `DELETE_COURSE_DATA`, `RE_INDEX`, `GET_ACTIVE_PLATFORM`, `GET_FALLBACK_STATUS`
    - Forward platform detection results from content script to side panel for platform indicator display
    - Forward fallback chain exhaustion events to side panel for notification display
    - _Requirements: 7.1, 8.2, 12.6, 13.6_

  - [ ] 11.2 Wire content script injection and communication
    - Create `src/content-script/index.ts` entry point
    - Register content script for URL patterns matching all registered adapters in manifest.json (initially D2L Brightspace patterns)
    - On page load, invoke AdapterRegistry.detectPlatform() and store the active adapter
    - Implement message listeners to respond to service worker requests for course metadata and document links via the active adapter
    - Handle course page navigation detection and notify service worker of course changes including platform name
    - _Requirements: 1.1, 8.2, 7.3, 12.2_

  - [ ] 11.3 Wire extension icon click to toggle side panel
    - Configure `chrome.sidePanel` API to open/close on action click
    - Ensure panel state persists across navigation within the active LMS platform
    - _Requirements: 7.1_

- [ ] 12. Final integration and end-to-end wiring
  - [ ] 12.1 Connect side panel to service worker for full query flow
    - Wire QueryPanel submit → service worker PROCESS_QUERY → RAG engine (with fallback chain) → response back to side panel
    - Wire IndexingPanel buttons → service worker START_INDEXING / RE_INDEX → orchestrator → progress updates back to UI
    - Wire course context switching on navigation with platform adapter detection
    - Wire platform indicator updates when adapter changes
    - Wire fallback chain exhaustion notification from service worker to NotificationArea
    - _Requirements: 4.1, 4.3, 8.2, 8.4, 12.6, 13.6_

  - [ ] 12.2 Implement build pipeline and extension packaging
    - Configure Vite/webpack to build content script, service worker, and side panel as separate bundles
    - Bundle the Gemini API free-tier key securely in the build output
    - Generate final `manifest.json` with correct paths and content script URL patterns for D2L Brightspace
    - Add build scripts to package.json: `build`, `dev`, `test`
    - Verify extension loads in Chrome without errors
    - _Requirements: 9.2, 13.1_

  - [ ]* 12.3 Write integration tests for indexing flow
    - Test full pipeline: mock LMS page → adapter detects platform → extract links → fetch documents → chunk → embed via Gemini → store
    - Verify progress events and final summary include platform name
    - _Requirements: 1.1, 3.1, 3.3, 3.5, 12.1, 13.2_

  - [ ]* 12.4 Write integration tests for query flow with fallback chain
    - Test full pipeline: submit query → embed → search → generate answer with citations via adapter's buildCitationUrl → display
    - Test confidence thresholds produce correct UI states
    - Test fallback chain behavior: mock 429 on primary → verify fallback to next model → verify response returned
    - Test full chain exhaustion → verify graceful degradation notification
    - _Requirements: 4.1, 4.2, 5.1, 6.2, 6.3, 13.4, 13.5, 13.6_

  - [ ]* 12.5 Write integration tests for platform adapter detection
    - Test AdapterRegistry correctly detects D2L Brightspace across multiple institutional URLs
    - Test graceful behavior when no adapter matches
    - Test platform indicator updates in side panel
    - _Requirements: 12.2, 12.3, 12.6_

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The extension uses TypeScript throughout with React for the side panel UI
- fast-check is used as the property-based testing library
- Vitest is the recommended test runner for fast TypeScript test execution
- The Platform Adapter pattern (Task 2) is foundational — all content scraping, course detection, and citation navigation flows through the active adapter
- New LMS platforms (Canvas, Moodle, Google Classroom) can be added by implementing a new adapter and registering it without modifying core components
- The extension ships with a bundled Gemini API free-tier key — no user API key configuration is needed
- All AI inference uses Google's Gemini API: `gemini-embedding-2` for embeddings (768-dim) and `gemini-2.5-flash` for generation with multi-model fallback
- The fallback chain (`gemini-2.5-flash` → `gemini-3.5-flash-lite` → `gemini-2.5-flash-lite`) ensures continued service when individual model quotas are exhausted

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5"] },
    { "id": 5, "tasks": ["3.1", "3.2"] },
    { "id": 6, "tasks": ["3.3", "3.4"] },
    { "id": 7, "tasks": ["3.5", "3.6", "3.7", "3.8"] },
    { "id": 8, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 9, "tasks": ["5.4", "5.5", "5.6", "5.7", "5.8"] },
    { "id": 10, "tasks": ["6.1"] },
    { "id": 11, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 12, "tasks": ["6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11", "6.12", "6.13"] },
    { "id": 13, "tasks": ["8.1", "8.2"] },
    { "id": 14, "tasks": ["8.3", "8.4", "8.5", "8.6"] },
    { "id": 15, "tasks": ["9.1"] },
    { "id": 16, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9"] },
    { "id": 17, "tasks": ["9.10", "9.11", "9.12"] },
    { "id": 18, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 19, "tasks": ["12.1", "12.2"] },
    { "id": 20, "tasks": ["12.3", "12.4", "12.5"] }
  ]
}
```
