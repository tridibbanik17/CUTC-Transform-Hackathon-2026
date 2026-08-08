# Implementation Plan: LMS RAG Browser Extension

## Overview

This plan implements a Chrome Manifest V3 browser extension that integrates a RAG AI agent into university learning management systems via a pluggable Platform_Adapter architecture. The extension uses the BYOK (Bring Your Own Key) model where users provide their personal Google Gemini API key. Document text extraction happens locally (PDF.js, PPTX), while all chunking, embedding, vector storage, and RAG orchestration are delegated to the Backboard.io backend. The Gemini API wrapper implements programmatic try-catch fallback (`gemini-3.6-flash` → `gemini-3.5-flash-lite` → `gemini-2.5-flash-lite`). IndexedDB stores only session history, preferences, and adapter state locally.

## Tasks

- [ ] 1. Project scaffolding, core interfaces, and local storage setup
  - [ ] 1.1 Initialize Chrome Manifest V3 project structure
    - Create directory layout: `src/platform/`, `src/platform/adapters/`, `src/content-script/`, `src/background/`, `src/side-panel/`, `src/shared/`, `tests/property/`, `tests/unit/`, `tests/integration/`
    - Create `manifest.json` with Manifest V3 configuration (side_panel, permissions for activeTab, storage, scripting)
    - Set up `tsconfig.json`, `package.json` with TypeScript, React, Vite bundler
    - Install dependencies: react, react-dom, pdf.js, fast-check, vitest, @google/generative-ai
    - _Requirements: 9.2, 13.1_

  - [ ] 1.2 Define core TypeScript interfaces and types
    - Create `src/types/index.ts` with shared interfaces: `CourseMetadata`, `DocumentLink`, `ExtractedDocument`, `PageContent`, `CitationMetadata`, `Citation`, `RAGResponse`, `IndexingResult`, `CourseStatus`, `HistoryEntry`, `PreferenceRecord`, `AdapterStateRecord`
    - Create `src/types/messages.ts` with message types for communication between service worker, content script, and side panel
    - Define `GeminiResponse`, `GeminiWrapper`, `ModelFallbackChain`, `RetryConfig` interfaces
    - Define `BackboardClient` interface with methods: `indexDocument`, `hasDocument`, `query`, `getCourseStatus`, `replaceCourseIndex`, `deleteCourse`
    - Define `APIKeyManager` interface with methods: `storeKey`, `getKey`, `getMaskedKey`, `validateKey`, `removeKey`, `hasKey`
    - _Requirements: 1.4, 3.2, 4.1, 5.1, 9.9, 13.3, 13.4, 13.5_

  - [ ] 1.3 Set up IndexedDB schema for local session data only
    - Create `src/background/db.ts` with database `lms-rag-session`
    - Object stores: `history` (key: `id`, index: `courseId+sessionId`), `preferences` (key: `key`), `adapters` (key: `name`)
    - Implement schema versioning and upgrade logic
    - Note: NO vector store or document metadata in IndexedDB — those live on Backboard.io
    - _Requirements: 7.7, 9.7, 11.1_

- [ ] 2. API Key Manager (BYOK)
  - [ ] 2.1 Implement API Key Manager module
    - Create `src/background/api-key-manager.ts` implementing `APIKeyManager` interface
    - `storeKey(key)`: Store validated key in `chrome.storage.local` under key `lms_rag_gemini_api_key`
    - `getKey()`: Retrieve the full API key for transmission to Backboard.io
    - `getMaskedKey()`: Return masked display version (e.g., "AIza...7x9Q" — first 4 + last 4 chars)
    - `validateKey(key)`: Make lightweight test request to Gemini API (`models.list` endpoint); return `{ valid, error? }`
    - `removeKey()`: Delete the key from local storage
    - `hasKey()`: Check if a valid key is currently configured
    - Key is NOT stored in IndexedDB — uses `chrome.storage.local` for immediate access
    - _Requirements: 9.2, 9.3, 9.4, 9.9, 11.1_

  - [ ]* 2.2 Write unit tests for API Key Manager
    - Test validation flow: valid key returns `{ valid: true }`, invalid key returns error message
    - Test masked key format (first 4 + last 4 characters visible)
    - Test store/retrieve/remove lifecycle
    - Test `hasKey` returns correct boolean
    - _Requirements: 9.3, 9.9_

- [ ] 3. Platform adapter layer and D2L Brightspace adapter
  - [ ] 3.1 Implement PlatformAdapter interface and AdapterRegistry
    - Create `src/platform/adapter.ts` defining the `PlatformAdapter` interface with: `name`, `urlPatterns`, `priority`, `matchesUrl()`, `isCoursePage()`, `extractCourseId()`, `extractCourseName()`, `getDocumentLinks()`, `buildCitationUrl()`
    - Create `src/platform/registry.ts` implementing `AdapterRegistry` with: `register()`, `detectPlatform()`, `getActivePlatform()`, `getRegisteredPlatforms()`
    - Registry evaluates adapters in priority order (lowest number = highest priority) and activates the first matching adapter
    - Registry returns `null` when no adapter matches the current URL
    - _Requirements: 12.1, 12.2, 12.5_

  - [ ] 3.2 Implement D2L Brightspace adapter
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

  - [ ] 3.3 Register D2L adapter and wire platform detection into content script
    - Create `src/platform/index.ts` that instantiates the AdapterRegistry and registers the D2L Brightspace adapter
    - Wire the registry into the content script so on page load, it calls `detectPlatform(url)` to determine the active adapter
    - Expose the active adapter to other components via message passing to the service worker
    - _Requirements: 12.2, 12.5_

  - [ ]* 3.4 Write property tests for adapter registry priority-based selection
    - **Property 25: Priority-based adapter selection**
    - **Validates: Requirements 12.2, 12.5**
    - Use fast-check to generate sets of mock adapters with distinct priorities and random URLs
    - Verify the registry activates the adapter with the lowest priority number whose URL pattern matches
    - Verify registry returns null when no adapter matches
    - Verify registering additional adapters does not alter matching behavior for previously registered adapters

  - [ ]* 3.5 Write property tests for D2L Brightspace adapter URL recognition
    - **Property 26: D2L Brightspace adapter URL recognition**
    - **Validates: Requirements 12.3**
    - Use fast-check to generate URLs with D2L patterns (*.brightspace.com domains, /d2l/ paths with various subdomains and institutional branding)
    - Verify all D2L-patterned URLs are matched by the adapter
    - Verify non-D2L URLs (Canvas, Moodle, generic websites) are not matched

- [ ] 4. Content scraper and document processor (local text extraction only)
  - [ ] 4.1 Implement content scraper delegating to active platform adapter
    - Create `src/content-script/scraper.ts` implementing `ScraperAPI`
    - `getCourseMetadata()` delegates to the active adapter's `extractCourseId()` and `extractCourseName()` and includes `platform` field from adapter's `name`
    - `getDocumentLinks()` delegates to the active adapter's `getDocumentLinks()`, then filters to supported file types (PDF, PPTX, HTML, PNG, JPG, JPEG)
    - `isSupportedCoursePage()` calls active adapter's `isCoursePage()`
    - `getActivePlatformName()` returns the name of the active adapter or null
    - Return `null` for pages where no adapter is active
    - _Requirements: 1.1, 7.5, 12.1, 12.2_

  - [ ] 4.2 Implement document text extraction (PDF, PPTX, HTML)
    - Create `src/background/document-processor.ts` implementing `DocumentProcessorAPI`
    - Implement PDF extraction using PDF.js: fetch document, extract text per page with page numbers and headings
    - Implement PPTX extraction: parse ZIP, extract XML slide text with slide numbers as page numbers
    - Implement HTML extraction: parse DOM content with heading detection
    - Enforce 50MB file size limit; skip documents exceeding the limit and emit notification
    - Implement `computeDocumentHash()` using SHA-256 for deduplication checks against Backboard.io
    - Note: NO local chunking — extracted text is sent whole to Backboard.io for chunking and embedding
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6_

  - [ ]* 4.3 Write property tests for supported document type filtering
    - **Property 1: Supported document type filtering**
    - **Validates: Requirements 1.1, 1.3**
    - Use fast-check to generate arrays of document links with mixed file types
    - Verify only supported types (PDF, PPTX, HTML, PNG, JPG, JPEG) are returned
    - Verify no unsupported types are included and no supported types excluded

  - [ ]* 4.4 Write property tests for document deduplication via content hash
    - **Property 3: Document deduplication via content hash**
    - **Validates: Requirements 1.6**
    - Verify that re-presenting an unchanged document (same hash) results in no re-extraction or re-indexing

  - [ ]* 4.5 Write property tests for metadata preservation
    - **Property 2: Metadata preservation through indexing**
    - **Validates: Requirements 1.4, 2.3, 2.4**
    - Verify every extracted document retains correct source file name, page numbers, and section headings

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Gemini API Wrapper with programmatic try-catch fallback
  - [ ] 6.1 Implement Gemini API Wrapper with fallback chain
    - Create `src/background/gemini-wrapper.ts` implementing `GeminiWrapper` interface
    - Define ordered fallback chain: `gemini-3.6-flash` (primary) → `gemini-3.5-flash-lite` (first fallback) → `gemini-2.5-flash-lite` (second fallback)
    - Implement programmatic try-catch error interception:
      - HTTP 404 → advance to next model immediately (deprecated/invalid endpoint)
      - HTTP 429 → advance to next model immediately (rate limit exhausted)
      - HTTP 500/503 → retry same model up to 2× with exponential backoff (1s, 3s), then advance
      - HTTP 400/401/403 → fail immediately, no retry, no advance
    - Implement `execute()`: attempt request against current model, catch errors, route per status code
    - Implement `getLastUsedModel()`: log which model handled the request
    - Implement `isExhausted()`: returns true when all models have returned 429/404
    - Implement `resetChain()`: reset chain state (e.g., after cooldown period)
    - On full chain exhaustion: halt cloud calls, emit "daily limit reached" notification event
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

  - [ ]* 6.2 Write property tests for fallback chain advancement on 429/404
    - **Property 22: Fallback chain advancement on 429/404**
    - **Validates: Requirements 13.3, 13.4, 13.7**
    - Use fast-check to simulate sequences of 429/404 responses
    - Verify models are attempted in exact order: `gemini-3.6-flash` → `gemini-3.5-flash-lite` → `gemini-2.5-flash-lite`, never skipping or reversing

  - [ ]* 6.3 Write property tests for server error retry before advancement
    - **Property 23: Server error retry before advancement**
    - **Validates: Requirements 13.8, 11.7**
    - Simulate HTTP 500/503 errors; verify same model retried at most 2 additional times with exponential backoff before advancing to next model

  - [ ]* 6.4 Write property tests for fallback chain exhaustion
    - **Property 24: Fallback chain exhaustion triggers graceful degradation**
    - **Validates: Requirements 13.5**
    - Simulate all models returning 429/404; verify cloud calls are halted, "daily limit reached" notification is emitted, and Backboard.io data remains accessible

- [ ] 7. Backboard.io client implementation
  - [ ] 7.1 Implement Backboard.io client module
    - Create `src/background/backboard-client.ts` implementing `BackboardClient` interface
    - Implement `indexDocument(params)`: send extracted text + metadata + user API key + content hash to Backboard.io for chunking and embedding; return `IndexingResult`
    - Implement `hasDocument(courseId, apiKey, hash)`: check if document already indexed by hash (deduplication)
    - Implement `query(params)`: send query text + courseId + API key to Backboard.io RAG orchestrator; return `RAGResponse` with answer, citations, confidenceScore, status
    - Implement `getCourseStatus(courseId, apiKey)`: retrieve indexing status and stats from Backboard.io
    - Implement `replaceCourseIndex(courseId, apiKey, documents)`: atomic re-index — send all documents, Backboard.io replaces old index on success
    - Implement `deleteCourse(courseId, apiKey)`: delete all indexed data for a course from Backboard.io
    - Apply retry logic: max 2 retries with exponential backoff (1s, 3s) on 500/502/503/504; fail on 400/401/403; route 429/404 to Gemini wrapper fallback
    - _Requirements: 3.1, 3.2, 4.1, 8.1, 8.3, 8.4, 10.1, 11.2, 11.4, 11.6_

  - [ ]* 7.2 Write property tests for course context isolation
    - **Property 14: Course context isolation**
    - **Validates: Requirements 8.1, 8.3**
    - Generate mock data for two courses; verify querying one course never returns chunks from the other

  - [ ]* 7.3 Write property tests for course data deletion completeness
    - **Property 20: Course data deletion completeness**
    - **Validates: Requirements 11.6**
    - After `deleteCourse()`, verify `getCourseStatus()` returns no records and `hasDocument()` returns false for all previously indexed hashes

  - [ ]* 7.4 Write property tests for chunk size and non-empty constraint
    - **Property 21: Chunk size and non-empty constraint on API transmission**
    - **Validates: Requirements 11.3**
    - Verify no text sent to Backboard.io is empty or zero-sized
    - Verify document content transmitted does not exceed the configured maximum

- [ ] 8. RAG engine and query processing
  - [ ] 8.1 Implement RAG engine orchestrating Backboard.io queries
    - Create `src/background/rag-engine.ts` implementing `RAGEngineAPI`
    - Implement `processQuery(courseId, query)`:
      - Retrieve API key via APIKeyManager
      - Call `backboardClient.query()` with courseId, apiKey, queryText
      - Evaluate response confidence:
        - If no chunk scores ≥ 0.4: return `{ status: 'insufficient_information', answer: '', citations: [] }`
        - If highest score ≥ 0.4 but < 0.6: return `{ status: 'low_confidence', ... }` with answer and warning
        - If highest score ≥ 0.6: return `{ status: 'success', ... }` with answer and citations
        - If Backboard.io returns retrieval failure: return `{ status: 'retrieval_error', ... }`
    - Build citation `sourceUrl` using the active Platform_Adapter's `buildCitationUrl()`
    - Ensure generated answers are ≤ 300 words
    - _Requirements: 4.1, 4.2, 4.4, 5.1, 5.5, 6.1, 6.2, 6.3, 6.4_

  - [ ] 8.2 Implement query input validation
    - Create `src/shared/validation.ts`
    - Reject empty, whitespace-only, or < 3 character queries
    - Enforce 500-character maximum length
    - Return validation error messages
    - _Requirements: 4.6, 7.2, 7.6_

  - [ ]* 8.3 Write property tests for confidence threshold — insufficient information
    - **Property 12: Confidence threshold — insufficient information**
    - **Validates: Requirements 5.5, 6.3**
    - Verify that when no chunk scores ≥ 0.4, status is "insufficient_information" with empty answer

  - [ ]* 8.4 Write property tests for confidence threshold — low confidence warning
    - **Property 13: Confidence threshold — low confidence warning**
    - **Validates: Requirements 6.2**
    - Verify that when highest score is ≥ 0.4 but < 0.6, status is "low_confidence"

  - [ ]* 8.5 Write property tests for answer word count constraint
    - **Property 9: Answer word count constraint**
    - **Validates: Requirements 4.2**
    - Verify generated answers never exceed 300 words

  - [ ]* 8.6 Write property tests for citation completeness
    - **Property 11: Citation completeness**
    - **Validates: Requirements 5.1**
    - Verify every citation has non-empty document name, valid page number, and section heading

  - [ ]* 8.7 Write property tests for invalid query rejection
    - **Property 10: Invalid query rejection**
    - **Validates: Requirements 4.6, 7.6**
    - Generate empty, whitespace-only, and < 3 char strings; verify all are rejected without being sent to Backboard.io

  - [ ]* 8.8 Write property tests for query length enforcement
    - **Property 16: Query input length enforcement**
    - **Validates: Requirements 7.2**
    - Generate strings > 500 characters; verify they are rejected

- [ ] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Indexing orchestration and progress tracking
  - [ ] 10.1 Implement indexing orchestrator in service worker
    - Create `src/background/indexing-orchestrator.ts`
    - Coordinate pipeline: receive document links from scraper (via adapter) → check deduplication via `backboardClient.hasDocument()` → extract text locally (DocumentProcessor) → send to `backboardClient.indexDocument()` for chunking + embedding + storage
    - Track progress per document, emit progress events (K/N percentage)
    - Handle partial failures: skip failed documents, preserve successful ones, continue processing
    - Update course status via `backboardClient.getCourseStatus()`: 'not_indexed' → 'indexing' → 'indexed'
    - Generate indexing summary (total documents, total chunks from IndexingResult)
    - _Requirements: 1.5, 1.6, 3.3, 3.4, 3.5, 10.1, 10.4_

  - [ ] 10.2 Implement re-indexing with atomic replacement via Backboard.io
    - Add re-indexing flow: extract all documents locally → call `backboardClient.replaceCourseIndex()` → on success, new index replaces old → on failure, retain old index unchanged on Backboard.io
    - Implement 15-minute timeout: cancel re-indexing if not complete, retain previous index, display timeout notification
    - Ensure existing data remains queryable during re-indexing
    - _Requirements: 8.4, 8.6, 8.8_

  - [ ]* 10.3 Write property tests for progress indicator accuracy
    - **Property 7: Progress indicator accuracy**
    - **Validates: Requirements 3.3**
    - Verify that after K of N documents complete, progress equals K/N

  - [ ]* 10.4 Write property tests for failure resilience
    - **Property 5: Failure resilience preserves partial progress**
    - **Validates: Requirements 1.5, 3.4, 10.4**
    - Simulate failures at position K; verify documents 1..K-1 remain indexed on Backboard.io

  - [ ]* 10.5 Write property tests for indexing summary accuracy
    - **Property 6: Indexing summary accuracy**
    - **Validates: Requirements 3.5**
    - Verify summary counts match actual stored documents and chunks reported by Backboard.io

  - [ ]* 10.6 Write property tests for atomic re-indexing with rollback
    - **Property 15: Atomic re-indexing with rollback**
    - **Validates: Requirements 8.4, 8.6**
    - Simulate re-indexing failure; verify old index is unchanged. Simulate success; verify new index replaces old.

- [ ] 11. Side panel UI implementation
  - [ ] 11.1 Create React side panel shell with routing
    - Create `src/side-panel/index.tsx` entry point with React root
    - Create `src/side-panel/App.tsx` with component hierarchy: Header, SettingsPanel, IndexingPanel, QueryPanel, OnboardingOverlay, PrivacyNotice, NotificationArea
    - Set up side panel HTML page referenced in manifest.json
    - Implement Chrome Side Panel API registration in service worker
    - _Requirements: 7.1, 7.3_

  - [ ] 11.2 Implement Header component with course detection, platform indicator, and status
    - Create `src/side-panel/components/Header.tsx`
    - Display current course name (received from content script via active adapter)
    - Show platform indicator displaying which LMS platform is detected (e.g., "D2L Brightspace")
    - Show indexing status indicator: not indexed (gray), indexing (animated), indexed (green)
    - Detect pages with no active adapter and display guidance message to navigate to a supported LMS
    - _Requirements: 7.3, 7.4, 7.5, 12.6_

  - [ ] 11.3 Implement SettingsPanel with API key management UI
    - Create `src/side-panel/components/SettingsPanel.tsx`
    - Display masked API key (e.g., "AIza...7x9Q") via `APIKeyManager.getMaskedKey()`
    - Provide input field and "Update Key" button to change the stored key (validates before storing)
    - Provide "Remove Key" button with confirmation dialog
    - Show validation status (valid/invalid) during key entry
    - Gate indexing and querying behind valid key presence
    - _Requirements: 9.2, 9.3, 9.9_

  - [ ] 11.4 Implement IndexingPanel with progress and controls
    - Create `src/side-panel/components/IndexingPanel.tsx`
    - Show progress bar with percentage during indexing
    - Provide "Index Course" button (single-click action) and "Re-index" button
    - Display indexing summary on completion (document count, chunk count)
    - Show error notification for failed documents
    - _Requirements: 3.3, 3.5, 8.5, 8.6, 9.6, 9.8_

  - [ ] 11.5 Implement QueryPanel with input, submission, and answer display
    - Create `src/side-panel/components/QueryPanel.tsx`
    - Text input field with 500-character max length, submit button
    - Client-side validation: reject empty/whitespace/< 3 char queries inline
    - Scrollable answer history area
    - Disable query input when no active platform adapter, no course context, or no valid API key
    - _Requirements: 7.2, 7.5, 7.6, 4.6, 8.7_

  - [ ] 11.6 Implement AnswerCard with markdown rendering, confidence, and citations
    - Create `src/side-panel/components/AnswerCard.tsx`
    - Render answer text with markdown (paragraphs, bullet points) using a lightweight markdown renderer
    - Display confidence score badge
    - Show low-confidence warning when status is "low_confidence"
    - Show "insufficient information" message when status is "insufficient_information"
    - Show "retrieval error" message when status is "retrieval_error"
    - Render citation list with document name, page number, section heading
    - Make citations clickable — navigate via Platform_Adapter's `buildCitationUrl()` (or show "unavailable" if inaccessible)
    - Display OCR/vision source indicator for citations derived from handwritten/visual content
    - _Requirements: 2.7, 4.4, 4.5, 5.1, 5.2, 5.3, 6.2, 6.4_

  - [ ] 11.7 Implement OnboardingOverlay with API key setup
    - Create `src/side-panel/components/OnboardingOverlay.tsx`
    - Display 4-step-or-fewer onboarding guide on first install:
      - Step 1: Welcome + what the extension does
      - Step 2: Generate a Gemini API key (link to Google AI Studio)
      - Step 3: Enter and validate the API key
      - Step 4: Navigate to a course to begin
    - Each step: max 1 illustration + 2 sentences of text
    - Integrate API key input + validation flow into onboarding
    - Persist dismissed state in IndexedDB preferences store only after prompt is fully displayed
    - Never re-show dismissed onboarding
    - _Requirements: 9.1, 9.2, 9.3, 9.7_

  - [ ] 11.8 Implement PrivacyNotice for external data transmission
    - Create `src/side-panel/components/PrivacyNotice.tsx`
    - Display first-time-in-session notice before sending data to Backboard.io or Gemini API
    - Inform user that content will be sent to external servers (Backboard.io for processing, Gemini API via their key)
    - Mention data is associated with user's isolated API credentials ensuring tenant separation
    - Track notice acknowledgment in session storage (resets each session)
    - _Requirements: 11.2, 11.5_

  - [ ] 11.9 Implement session history persistence
    - Create `src/side-panel/hooks/useSessionHistory.ts`
    - Store query/answer pairs in IndexedDB `history` object store keyed by courseId + sessionId
    - Restore history when extension is reopened within same browser session
    - _Requirements: 7.7_

  - [ ] 11.10 Implement notification area for errors, warnings, and rate limits
    - Create `src/side-panel/components/NotificationArea.tsx`
    - Display extraction failures, unsupported format notices, API errors, platform adapter errors
    - Display "daily limit reached" notification when Gemini fallback chain is fully exhausted
    - Show platform-specific error messages when adapter encounters errors during page detection
    - Show API key related errors (missing, invalid)
    - Auto-dismiss after timeout or allow manual close
    - _Requirements: 1.3, 1.5, 3.4, 12.7, 13.5_

  - [ ]* 11.11 Write property tests for unsupported page detection
    - **Property 17: Unsupported page detection**
    - **Validates: Requirements 7.5, 12.2**
    - Generate URLs that don't match any registered adapter's patterns; verify query input is disabled

  - [ ]* 11.12 Write property tests for session history persistence
    - **Property 18: Session history persistence**
    - **Validates: Requirements 7.7**
    - Simulate sequence of queries, close/reopen, verify complete history retained in IndexedDB

  - [ ]* 11.13 Write property tests for dismissed prompt persistence
    - **Property 19: Dismissed prompt persistence**
    - **Validates: Requirements 9.7**
    - Dismiss prompts and verify they are never shown again across sessions

- [ ] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Service worker message routing and integration wiring
  - [ ] 13.1 Implement service worker message handler
    - Create `src/background/service-worker.ts`
    - Register Chrome side panel on extension install
    - Route messages between content script, side panel, and background modules
    - Handle message types: `GET_COURSE_INFO`, `START_INDEXING`, `PROCESS_QUERY`, `GET_INDEX_STATUS`, `DELETE_COURSE_DATA`, `RE_INDEX`, `GET_ACTIVE_PLATFORM`, `GET_FALLBACK_STATUS`, `VALIDATE_API_KEY`, `GET_API_KEY_STATUS`
    - Forward platform detection results from content script to side panel for platform indicator
    - Forward fallback chain exhaustion events to side panel for notification
    - Gate indexing/query operations behind valid API key check
    - _Requirements: 7.1, 8.2, 9.4, 12.6, 13.5_

  - [ ] 13.2 Wire content script injection and communication
    - Create `src/content-script/index.ts` entry point
    - Register content script for URL patterns matching all registered adapters (initially D2L Brightspace)
    - On page load, invoke AdapterRegistry.detectPlatform() and store the active adapter
    - Implement message listeners to respond to service worker requests for course metadata and document links via the active adapter
    - Handle course page navigation detection and notify service worker of course changes including platform name
    - _Requirements: 1.1, 8.2, 7.3, 12.2_

  - [ ] 13.3 Wire extension icon click to toggle side panel
    - Configure `chrome.sidePanel` API to open/close on action click
    - Ensure panel state persists across navigation within the active LMS platform
    - _Requirements: 7.1_

- [ ] 14. Final integration and end-to-end wiring
  - [ ] 14.1 Connect side panel to service worker for full query flow
    - Wire QueryPanel submit → service worker PROCESS_QUERY → RAG engine (via Backboard.io) → response back to side panel
    - Wire IndexingPanel buttons → service worker START_INDEXING / RE_INDEX → indexing orchestrator (local extraction → Backboard.io) → progress updates back to UI
    - Wire course context switching on navigation with platform adapter detection
    - Wire platform indicator updates when adapter changes
    - Wire fallback chain exhaustion notification from service worker to NotificationArea
    - Wire API key state changes to enable/disable indexing and querying
    - _Requirements: 4.1, 4.3, 8.2, 8.4, 9.4, 12.6, 13.5_

  - [ ] 14.2 Implement build pipeline and extension packaging
    - Configure Vite to build content script, service worker, and side panel as separate bundles
    - Generate final `manifest.json` with correct paths and content script URL patterns for D2L Brightspace
    - Add build scripts to package.json: `build`, `dev`, `test`
    - Verify extension loads in Chrome without errors
    - _Requirements: 9.2, 13.1_

  - [ ]* 14.3 Write integration tests for indexing flow via Backboard.io
    - Test full pipeline: mock LMS page → adapter detects platform → extract links → fetch documents → extract text locally → send to Backboard.io → receive IndexingResult
    - Verify progress events and final summary match Backboard.io response
    - Verify deduplication: re-submitting unchanged document is skipped
    - _Requirements: 1.1, 1.6, 3.1, 3.3, 3.5, 12.1_

  - [ ]* 14.4 Write integration tests for query flow with Backboard.io and fallback chain
    - Test full pipeline: submit query → Backboard.io processes → answer + citations returned → display in side panel
    - Test confidence thresholds produce correct UI states
    - Test fallback chain: mock 429 on primary → verify Gemini wrapper falls back → response returned
    - Test full chain exhaustion → verify graceful degradation notification
    - _Requirements: 4.1, 4.2, 5.1, 6.2, 6.3, 13.3, 13.4, 13.5_

  - [ ]* 14.5 Write integration tests for platform adapter detection
    - Test AdapterRegistry correctly detects D2L Brightspace across multiple institutional URLs
    - Test graceful behavior when no adapter matches
    - Test platform indicator updates in side panel
    - _Requirements: 12.2, 12.3, 12.6_

  - [ ]* 14.6 Write integration tests for API key management flow
    - Test onboarding with key entry → validation → storage → main interface access
    - Test settings panel: view masked key, update key, remove key
    - Test that indexing and querying are blocked without a valid key
    - _Requirements: 9.2, 9.3, 9.9_

- [ ] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- **Key architectural difference from previous plan**: No local IndexedDB vector store — all chunking, embedding, vector storage, and RAG orchestration delegated to Backboard.io
- **BYOK model**: API key management is a core flow — onboarding, settings, and all API calls depend on user-provided Gemini key
- **Fallback chain**: `gemini-3.6-flash` → `gemini-3.5-flash-lite` → `gemini-2.5-flash-lite` with programmatic try-catch error interception
- **Document Processor**: Local text extraction only (PDF.js, PPTX) — extracted text sent to Backboard.io for chunking and embedding

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3"] },
    { "id": 6, "tasks": ["4.4", "4.5", "6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "6.4", "7.1"] },
    { "id": 8, "tasks": ["7.2", "7.3", "7.4", "8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8"] },
    { "id": 10, "tasks": ["10.1"] },
    { "id": 11, "tasks": ["10.2", "10.3", "10.4", "10.5", "10.6"] },
    { "id": 12, "tasks": ["11.1"] },
    { "id": 13, "tasks": ["11.2", "11.3", "11.4", "11.5"] },
    { "id": 14, "tasks": ["11.6", "11.7", "11.8", "11.9", "11.10"] },
    { "id": 15, "tasks": ["11.11", "11.12", "11.13"] },
    { "id": 16, "tasks": ["13.1", "13.2"] },
    { "id": 17, "tasks": ["13.3", "14.1"] },
    { "id": 18, "tasks": ["14.2"] },
    { "id": 19, "tasks": ["14.3", "14.4", "14.5", "14.6"] }
  ]
}
```
