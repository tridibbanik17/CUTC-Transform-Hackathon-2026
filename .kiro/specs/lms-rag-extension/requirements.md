# Requirements Document

## Introduction

A browser extension that integrates a Retrieval-Augmented Generation (RAG) AI agent into university learning management systems (LMS). The extension detects and extracts course materials (lecture slides, assignments, past exams, announcements) from LMS pages and sends them to the Backboard.io backend for document chunking, vector storage, and retrieval-augmented generation. Students receive concise, accurate answers to their questions — each paired with direct links back to the exact source document for instant verification. The system prioritizes accuracy over breadth to avoid misinformation. Users provide their own Google Gemini API key (BYOK model) targeting Google AI Studio free tier models, achieving $0 compute cost. The Backboard.io API manages state, conversational memory, and RAG orchestration server-side. The architecture uses a pluggable platform adapter pattern so that multiple LMS platforms can be supported — shipping first with D2L Brightspace, with Canvas, Moodle, and Google Classroom adapters to follow.

## Glossary

- **Extension**: The browser extension application (Chrome, Manifest V3) handling UI, local document selection, and secure local storage of user credentials
- **RAG_Engine**: The Backboard.io-powered backend that processes queries by retrieving relevant document chunks from the vector store and generating answers using the user's Gemini API key
- **Document_Indexer**: The Backboard.io component responsible for chunking and embedding course materials into a searchable vector store
- **Query_Interface**: The UI panel within the extension where students type questions and receive answers
- **Source_Citation**: A reference linking an answer back to the specific document, page, or section from which the information was retrieved
- **Vector_Store**: The Backboard.io-managed database storing document embeddings for semantic similarity search
- **Confidence_Score**: A numerical indicator (0.0 to 1.0) representing how well retrieved documents match a query
- **Course_Context**: The set of all indexed materials belonging to a specific course, managed server-side by Backboard.io
- **Backboard_API**: The Backboard.io API managing state, conversational memory, document chunking, vector storage, and retrieval-augmented generation (RAG) server-side
- **D2L_Brightspace**: The learning management system (LMS) used by McMaster University and many Ontario institutions, also known as Avenue to Learn
- **Canvas**: The LMS used by University of Toronto (Quercus), UBC, and many US universities
- **Moodle**: The open-source LMS used by York University (eClass) and many international institutions
- **Google_Classroom**: The LMS primarily used in K-12 but also adopted by some post-secondary programs
- **Platform_Adapter**: An interface that encapsulates LMS-specific logic (page detection, content scraping, URL parsing, navigation) behind a common API so the core extension logic remains platform-agnostic
- **Content_Scraper**: The component that extracts course materials from LMS pages via the active Platform_Adapter
- **OCR_Engine**: The Optical Character Recognition component that converts scanned or handwritten text within images and PDFs into machine-readable text
- **Vision_Model**: An AI model capable of interpreting visual content (diagrams, charts, figures) and producing natural language descriptions of their meaning
- **Gemini_API**: Google's generative AI API accessed via the user's personal API key (BYOK model), targeting free-tier models for embedding generation and language model inference at $0 compute cost
- **BYOK**: Bring Your Own Key — the model where each user provides their personal Google Gemini API key generated via Google AI Studio, stored securely in the extension's local storage
- **Model_Fallback_Chain**: The ordered sequence of Gemini models (`gemini-3.6-flash` → `gemini-3.5-flash-lite` → `gemini-2.5-flash-lite`) the extension attempts when a model returns HTTP 429 (rate limit) or HTTP 404 (deprecated endpoint), ensuring continued service by failing over to alternate models with independent quota pools

## Requirements

### Requirement 1: Course Content Extraction

**User Story:** As a student, I want the extension to automatically detect and extract course materials from my LMS course pages, so that I don't have to manually upload documents.

#### Acceptance Criteria

1. WHEN a user navigates to a supported LMS course page, THE Content_Scraper SHALL use the active Platform_Adapter to detect all linked and embedded course materials of supported types (PDF, PPTX, HTML content, and image files including PNG, JPG, and JPEG) within 10 seconds of page load
2. WHEN a document is detected on the course page and its size is at or below 50 MB, THE Content_Scraper SHALL extract the text content from the document without requiring the user to download it manually; IF a document exceeds 50 MB, THEN THE Content_Scraper SHALL skip extraction of that document and display a notification in the Extension side panel indicating the file name and that it exceeds the size limit
3. IF the Content_Scraper encounters a document format it cannot process, THEN THE Extension SHALL display a notification identifying the unsupported file name and its format within the Extension side panel; IF a supported document format fails during extraction, THEN THE Extension SHALL display a separate error message distinguishing extraction failure from unsupported format
4. WHEN the Content_Scraper extracts content from a document, THE Document_Indexer SHALL preserve the source file name, page number (for paginated formats), and top-level heading text (H1/H2 or slide title) as metadata
5. IF the Content_Scraper fails to extract content from a supported document partway through processing, THEN THE Extension SHALL display an error notification identifying the failed document and continue extracting remaining documents on the page
6. WHEN the Content_Scraper detects a document that has already been extracted and indexed with no changes, THE Content_Scraper SHALL skip re-extraction of that document, UNLESS the user explicitly requests a full refresh of course materials or the document's format support status has changed since the last extraction
7. WHEN a user explicitly triggers a full course refresh, THE Content_Scraper SHALL re-extract all course materials regardless of whether they were previously indexed

### Requirement 2: Handwritten and Visual Content Processing

**User Story:** As a student, I want the extension to extract and understand handwritten notes, scanned documents, and diagrams in my course materials, so that I can query all content — not just typed text.

#### Acceptance Criteria

1. WHEN the Content_Scraper detects a PDF page or image that contains no extractable text layer, THE OCR_Engine SHALL perform optical character recognition on the page to extract handwritten or printed text
2. WHEN the Content_Scraper encounters an embedded image (PNG, JPG, JPEG) or a slide/page containing a diagram, chart, or figure, THE Vision_Model SHALL generate a natural language description of the visual content summarizing its meaning and key elements
3. WHEN the OCR_Engine extracts text from a scanned or handwritten page with confidence at or above the readable threshold, THE Document_Indexer SHALL store the extracted text as a chunk with metadata indicating the content source type as "ocr" along with the source file name and page number; WHEN OCR confidence is below the readable threshold but some readable text was extracted, THE Document_Indexer SHALL store the text as a low-quality chunk with metadata indicating content source type as "ocr-low-confidence" and flag it accordingly in the indexing summary; IF the OCR_Engine extracts no readable text at all from a page, THEN THE Document_Indexer SHALL NOT store any chunk for that page
4. WHEN the Vision_Model generates a description of a diagram or figure, THE Document_Indexer SHALL store the description as a chunk with metadata indicating the content source type as "vision" and include the original image reference for citation purposes
5. IF the OCR_Engine cannot extract legible text from a page (confidence below a readable threshold), THEN THE Extension SHALL flag that page as "low-quality OCR" in the indexing summary and still attempt to index any partially extracted content; IF OCR completely fails to extract any text from a page, THEN THE Extension SHALL flag that page as "OCR failure" in the indexing summary
6. IF the Vision_Model fails to process an image or returns an empty description, THEN THE Extension SHALL log the skipped image in the indexing summary and continue processing remaining content
7. WHEN a Source_Citation references content derived from OCR or vision processing, THE Query_Interface SHALL display a visual indicator distinguishing it from text-extracted content so the student knows the source was interpreted from handwritten or visual material

### Requirement 3: Document Indexing and Embedding

**User Story:** As a student, I want my course materials to be indexed quickly and accurately, so that I can start asking questions shortly after opening a course.

#### Acceptance Criteria

1. WHEN the Content_Scraper delivers extracted text, THE Backboard_API SHALL split the text into chunks between 200 and 1000 tokens each, preserving sentence boundaries so that no sentence is split across two chunks
2. WHEN chunks are created, THE Backboard_API SHALL generate vector embeddings using the user's Gemini API key and store them in the Vector_Store along with source metadata including the source file name, page number, and section heading; IF embedding generation fails for a chunk, THEN THE Backboard_API SHALL NOT store the metadata for that chunk and SHALL report the failure in the indexing summary
3. WHILE indexing is in progress, THE Extension SHALL display a progress indicator showing the percentage of documents indexed and update the indicator after each document completes
4. IF any indexing-related component (Document_Indexer, Vector_Store, or embedding service) encounters an error during processing, THEN THE Extension SHALL skip the problematic content, continue indexing remaining documents, and display a notification to the user identifying the skipped content by file name and the component that failed; THE Extension SHALL only display error notifications when actual errors have occurred
5. WHEN indexing of all delivered documents completes successfully, THE Extension SHALL update the course indexing status to "indexed" and display a summary indicating the total number of documents and chunks indexed

### Requirement 4: Natural Language Query Processing

**User Story:** As a student, I want to ask questions in plain English about my course materials, so that I can find information without remembering exact document locations.

#### Acceptance Criteria

1. WHEN a user submits a query through the Query_Interface, THE RAG_Engine SHALL retrieve the top 5 most semantically relevant document chunks from the Vector_Store based on the query embedding similarity
2. WHEN relevant chunks are retrieved, THE RAG_Engine SHALL generate an answer of no more than 300 words synthesized from the retrieved content
3. THE RAG_Engine SHALL complete query processing and display an answer within 10 seconds of submission
4. WHEN the RAG_Engine generates an answer containing at least one word of substantive content, THE Query_Interface SHALL display the answer formatted with markdown rendering including paragraph breaks and bullet points where applicable
5. IF the RAG_Engine produces a response with zero words of substantive content, THEN THE Query_Interface SHALL display a message indicating that no meaningful answer could be generated and SHALL NOT render an empty answer area
6. IF a user submits an empty query or a query with fewer than 3 characters, THEN THE Query_Interface SHALL display an error message indicating that the query is too short and prompt the user to enter a more detailed question

### Requirement 5: Source Citation and Verification

**User Story:** As a student, I want every answer to include links back to the exact source material, so that I can verify the information and study the original content.

#### Acceptance Criteria

1. WHEN the RAG_Engine generates an answer, THE Query_Interface SHALL display one or more Source_Citations adjacent to the answer, each identifying the document name, page number, and section heading as preserved by the Document_Indexer metadata
2. WHEN a user clicks a Source_Citation, THE Extension SHALL navigate the user to the original document location within the active LMS platform using the Platform_Adapter's navigation logic
3. IF a user clicks a Source_Citation and the referenced document is no longer accessible in the LMS, THEN THE Extension SHALL display a message indicating the source document is unavailable and retain the citation metadata (document name, page number, section heading) for reference; THE Query_Interface SHALL only render citation links as clickable when citations are present and displayed
4. THE RAG_Engine SHALL include at least one Source_Citation for every factual claim in the generated answer, such that each claim is traceable to a specific document chunk retrieved from the Vector_Store; IF the RAG_Engine generates an answer containing factual claims but fails to provide citations, THEN THE Query_Interface SHALL still display the answer without citations
5. IF the RAG_Engine cannot find source material with a Confidence_Score at or above the defined threshold for a query, THEN THE Query_Interface SHALL display a message stating that no relevant information was found in the indexed course materials rather than generating an unsupported answer; IF the system fails to render the specific "no relevant information" message, THEN THE Query_Interface SHALL display a generic error message as a fallback

### Requirement 6: Answer Accuracy and Confidence

**User Story:** As a student, I want to trust that the answers I receive are accurate and grounded in my course materials, so that I don't study incorrect information.

#### Acceptance Criteria

1. THE RAG_Engine SHALL generate answers exclusively from content present in the indexed course materials for the active Course_Context, and SHALL NOT include information from external sources or general knowledge beyond the indexed materials
2. WHEN the RAG_Engine retrieves chunks where the highest Confidence_Score is below 0.6 on a 0.0 to 1.0 scale, THE Query_Interface SHALL display the generated answer accompanied by a visually distinct warning indicating low confidence in the answer
3. IF no retrieved chunk achieves a Confidence_Score of 0.4 or above on a 0.0 to 1.0 scale AND chunks were successfully retrieved from the Vector_Store, THEN THE RAG_Engine SHALL respond with an "insufficient information" message indicating the indexed course materials do not contain relevant content for the query, and SHALL NOT generate an answer
4. IF the Vector_Store returns zero chunks for a query due to retrieval failure, THEN THE Query_Interface SHALL display an error message indicating a retrieval problem and suggest the user retry the query
4. WHEN the RAG_Engine generates an answer, THE Query_Interface SHALL display the Confidence_Score value alongside the answer so the student can assess answer reliability

### Requirement 7: Extension User Interface

**User Story:** As a student, I want a clean, intuitive interface that I can access without leaving my LMS page, so that I can get answers quickly while studying.

#### Acceptance Criteria

1. WHEN a user clicks the Extension icon in the browser toolbar, THE Extension SHALL open a side panel overlay on the current LMS page, and WHEN the user clicks the Extension icon again or a close button within the panel, THE Extension SHALL close the side panel
2. THE Query_Interface SHALL provide a text input field with a maximum length of 500 characters for entering questions, a submit button to send the query, and a scrollable area displaying the answer history for the current session
3. WHEN the Extension is opened on a supported LMS course page, THE Extension SHALL automatically detect and display the current course name within the panel header using the active Platform_Adapter
4. THE Extension SHALL provide a visual indicator showing the indexing status of the current course (not indexed, indexing in progress, indexed)
5. IF the Extension is opened on a page that is not a supported LMS course page, THEN THE Extension SHALL display a message informing the user to navigate to a supported course page and SHALL disable the query input field
6. IF the user attempts to submit an empty or whitespace-only query, THEN THE Query_Interface SHALL not send the query to the RAG_Engine and SHALL keep the input field focused for correction
7. WHEN the Extension is closed and reopened within the same browser session on the same course page, THE Query_Interface SHALL retain the answer history from that session

### Requirement 8: Course Scope Management

**User Story:** As a student, I want to control which course materials are indexed, so that I get answers relevant to my current study context.

#### Acceptance Criteria

1. THE Extension SHALL maintain separate Course_Contexts for each distinct course the user accesses, identified by the unique course identifier extracted by the active Platform_Adapter from the LMS URL
2. WHEN a user navigates to a different course page on a supported LMS, THE Extension SHALL switch to the corresponding Course_Context within 2 seconds and update the displayed course name
3. WHEN a user asks a question, THE RAG_Engine SHALL search only within the active Course_Context and SHALL NOT return results from other indexed courses
4. WHEN a user manually triggers re-indexing of the current course, THE Extension SHALL preserve existing indexed content and remain queryable until new indexing completes, then replace the previous index with the updated content; IF re-indexing does not complete within 15 minutes, THEN THE Extension SHALL cancel the re-indexing operation, retain the previous index, and display a timeout notification to the user
5. IF a user navigates to a course that has never been visited before and has no existing Course_Context, THEN THE Extension SHALL create a new empty Course_Context and, only after successful context creation, prompt the user to begin indexing; IF context creation fails, THEN THE Extension SHALL display an error message and SHALL NOT prompt for indexing
6. IF a user navigates to a course that has an existing Course_Context but has not been indexed, THEN THE Extension SHALL display the existing context status without re-prompting for indexing, and provide an accessible option to initiate indexing within the Extension panel
6. IF re-indexing fails before completion, THEN THE Extension SHALL retain the previously indexed content unchanged and display an error message indicating which documents failed to index; queries SHALL continue to function normally against the previously indexed content while the error message is displayed
7. IF a user submits a query while no active Course_Context is available, THEN THE Query_Interface SHALL display a message instructing the user to navigate to a supported LMS course page
8. WHEN a user navigates to a course that has an existing Course_Context with indexed materials from a previous session, THE Extension SHALL display the indexed status and provide options to re-index or query immediately

### Requirement 9: Onboarding and Setup

**User Story:** As a first-time user, I want to start using the extension with minimal setup, so that I can get value immediately without a complicated configuration process.

#### Acceptance Criteria

1. WHEN a user installs the Extension for the first time, THE Extension SHALL display an onboarding guide explaining its core functionality (including the one-time API key setup) in four steps or fewer, with each step containing no more than one illustration and two sentences of text
2. THE Extension SHALL require the user to provide a valid Google Gemini API key (generated via Google AI Studio) during onboarding before indexing or querying can be used; THE Extension SHALL provide clear instructions linking to Google AI Studio for key generation
3. WHEN the user enters an API key during setup, THE Extension SHALL validate the key by making a lightweight test request to the Gemini API; IF validation succeeds, THE Extension SHALL store the key securely in the browser's local storage and proceed to the main interface; IF validation fails, THE Extension SHALL display an error indicating the key is invalid and prompt the user to re-enter it
4. THE Extension SHALL store the API key only in the browser's local storage on the user's device and SHALL NOT transmit the key to any server other than the Gemini API endpoints and the Backboard.io backend (which uses it to authenticate Gemini requests on behalf of the user)
5. WHEN the user navigates to a supported LMS course page for the first time with the Extension installed and a valid API key configured, THE Extension SHALL prompt the user to begin indexing the course materials
6. THE Extension SHALL provide a single-click action to begin indexing all available materials for the current course
7. WHEN the user dismisses the onboarding guide or the indexing prompt, THE Extension SHALL not display that same prompt again on subsequent visits, and SHALL persist this dismissal state across browser sessions; THE Extension SHALL only track dismissal state for prompts that were fully displayed to the user and where the display flag confirms the prompt was shown
8. THE Extension SHALL provide an accessible option within the Extension panel to manually initiate indexing for any unindexed course, regardless of whether the indexing prompt was previously shown or dismissed
9. THE Extension SHALL provide a settings area within the side panel where the user can view (masked), update, or remove their stored API key

### Requirement 10: Performance and Scalability

**User Story:** As a student taking multiple courses, I want the extension to handle large volumes of materials efficiently, so that it remains responsive throughout the semester.

#### Acceptance Criteria

1. THE Backboard_API SHALL process a typical course's materials (up to 50 documents totalling 500 pages) within 5 minutes of receiving the extracted content from the Extension
2. WHILE 10 courses are simultaneously indexed in the Vector_Store, THE RAG_Engine SHALL return query results within the same 10-second threshold as when a single course is indexed
3. WHEN the user queries an indexed course containing up to 500 documents, THE RAG_Engine SHALL return results within 10 seconds
4. IF the Backboard_API fails or times out during processing, THEN THE Extension SHALL preserve any documents already indexed in that session and display a notification indicating the indexing was incomplete with the count of successfully indexed documents

### Requirement 11: Privacy and Data Handling

**User Story:** As a student, I want my course materials and queries to be handled securely, so that my academic content is not exposed to unauthorized parties.

#### Acceptance Criteria

1. THE Extension SHALL store the user's Gemini API key securely in the browser's local storage and SHALL NOT expose it in any user-visible log, network request header visible to third parties, or extension page source
2. THE Extension SHALL transmit extracted course document chunks to the Backboard_API for processing; all data SHALL be associated with the user's isolated API credentials ensuring tenant separation
3. WHEN sending content to the Backboard_API for processing, THE Extension SHALL transmit only individual text chunks not exceeding the size defined by the Document_Indexer chunking configuration, SHALL not transmit entire documents in a single request, and SHALL NOT transmit empty or zero-sized chunks that provide no meaningful content for processing
4. THE Backboard_API SHALL process and store course chunks and state vectors securely using the user's isolated API credentials; raw course content SHALL NOT be accessible to other users of the platform
5. WHEN the Extension transmits data to the Backboard_API or Gemini API for the first time in a session, THE Extension SHALL display a notice informing the user that content will be sent to external servers for processing
6. THE Extension SHALL provide a user-accessible action to request deletion of all indexed course data for a given Course_Context from the Backboard_API
7. IF a request to the Backboard_API or Gemini API fails or times out, THEN THE Extension SHALL not retry transmission of the same content more than 2 additional times; IF all retry attempts are exhausted, THEN THE Extension SHALL display an error message to the user only if the user is still in the relevant interface context, and abandon the request

### Requirement 12: LMS Platform Abstraction

**User Story:** As a student at any Canadian university, I want the extension to work with my institution's LMS regardless of which platform they use, so that I am not excluded based on my school's technology choice.

#### Acceptance Criteria

1. THE Extension SHALL implement a Platform_Adapter interface that encapsulates all LMS-specific logic including page detection, course identification, content scraping selectors, document URL resolution, and navigation for source citations
2. WHEN the Extension loads on any web page, THE Extension SHALL evaluate registered Platform_Adapters in priority order and activate the first adapter whose URL pattern matches the current page; IF no adapter matches, THEN THE Extension SHALL remain inactive and display a message that the current page is not a supported LMS
3. THE Extension SHALL ship with a fully functional D2L Brightspace Platform_Adapter as the initial supported platform, capable of detecting course pages on any D2L Brightspace instance regardless of the institution's branding (e.g., Avenue to Learn, Waterloo LEARN)
4. EACH Platform_Adapter SHALL implement the following capabilities: detect whether the current page is a course page, extract the unique course identifier from the URL, extract the course display name, enumerate available course materials with download URLs, and construct navigation URLs for source citation links
5. WHEN a new Platform_Adapter is registered, THE Extension SHALL make it available for matching without requiring changes to the core RAG pipeline, Document_Indexer, Vector_Store, or Query_Interface components
6. THE Extension SHALL provide a platform indicator in the side panel header showing which LMS platform is currently detected (e.g., "D2L Brightspace", "Canvas", "Moodle", "Google Classroom")
7. IF the Extension detects a supported LMS platform but the active Platform_Adapter encounters an error during page detection or course identification, THEN THE Extension SHALL display an error message specific to the platform and suggest the user refresh the page

### Requirement 13: AI Model Fallback and Rate Limit Handling

**User Story:** As a student, I want the extension to work reliably even during peak usage times, so that I am never blocked from getting answers due to API rate limits or deprecated model endpoints.

#### Acceptance Criteria

1. THE Extension SHALL use the user's personal Gemini API key (BYOK model) targeting Google AI Studio free tier models for all AI inference, achieving $0 compute cost to the user
2. THE Extension SHALL use `gemini-3.6-flash` as the primary model for answer generation, vision/OCR processing, and embedding generation
3. WHEN the primary model (`gemini-3.6-flash`) returns an HTTP 429 (rate limit exhaustion) or HTTP 404 (deprecated/invalid endpoint) response, THE Extension SHALL automatically retry the request using the first fallback model (`gemini-3.5-flash-lite`)
4. WHEN the first fallback model (`gemini-3.5-flash-lite`) also returns an HTTP 429 or HTTP 404 response, THE Extension SHALL automatically retry the request using the second fallback model (`gemini-2.5-flash-lite`)
5. WHEN all models in the fallback chain return HTTP 429 or HTTP 404 responses, THE Extension SHALL halt automated retries, display a notification informing the user that the free daily API limit has been reached or that models are unavailable, and preserve access to previously indexed data via the Backboard_API so the user can still browse prior answers
6. THE Extension SHALL implement the fallback chain transparently to the user — the user SHALL NOT need to select or configure models manually
7. THE Extension SHALL implement programmatic try-catch error interception in the API wrapper layer to catch HTTP 404 and HTTP 429 status codes and trigger automated sequential model fallback
8. WHEN a model in the fallback chain returns a server error (e.g., HTTP 500, 503), THE Extension SHALL retry the same model up to 2 additional times with exponential backoff before advancing to the next model in the fallback chain
9. THE Extension SHALL log which model successfully handled each request for debugging purposes, but SHALL NOT expose model selection details to the user in the main interface

### Requirement 14: Large Document and Textbook Support

**User Story:** As a student, I want to index full digital textbooks (1000–1500 pages) without being blocked by API rate limits, so that I can query any course material regardless of its size.

#### Acceptance Criteria

1. WHEN the Extension encounters a document exceeding 100 pages, THE Extension SHALL offer the user the option to index the document incrementally by chapter or section rather than processing the entire document in a single session
2. WHEN the user selects incremental indexing, THE Extension SHALL detect chapter or section boundaries using heading structure (H1/H2 headings or PDF bookmarks) and present a list of available sections for the user to select
3. WHEN incremental indexing is active, THE Extension SHALL index only the selected sections in the current session and preserve progress so that remaining sections can be indexed in subsequent sessions without re-processing already-indexed sections
4. IF the Gemini API returns HTTP 429 (rate limit exhaustion) during document indexing AND the fallback chain is fully exhausted, THEN THE Extension SHALL pause indexing at the current position, preserve all successfully indexed chunks on Backboard.io, and display a notification indicating how many pages/sections were indexed and how many remain; THE Extension SHALL automatically resume indexing from the paused position when the user returns in a subsequent session
5. THE Extension SHALL support documents up to 200 MB in size (increased from 50 MB for textbooks); IF a document exceeds 200 MB, THEN THE Extension SHALL skip extraction and display a notification indicating the file exceeds the maximum supported size
6. WHEN a large document is being indexed incrementally, THE Extension SHALL display progress at the section level (e.g., "Chapter 3 of 12 indexed") in addition to the document-level percentage
7. WHEN a user queries a course with a partially-indexed textbook, THE RAG_Engine SHALL search only the sections that have been indexed so far and indicate in the response if the answer may be incomplete due to partial indexing
