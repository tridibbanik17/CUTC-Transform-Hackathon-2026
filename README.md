# CourseChat

A Chrome extension that turns your school's course page (Brightspace, Canvas) into an AI tutor by indexing lectures and exams, then answering questions with cited sources using your free Gemini key.

## Architecture

### What runs in the browser (Chrome Extension)

- **Content scraping** — Platform adapters detect your LMS and extract course materials
- **Local text extraction** — PDF.js and PPTX parser pull text from documents client-side
- **UI rendering** — React side panel for queries, answers, and settings
- **API key management** — Your Gemini key stored securely in browser local storage

### What runs on the backend (Backboard.io)

Backboard.io is the RAG orchestration backend. It handles all the compute-intensive work so the extension stays lightweight:

- **Document chunking** — Splits extracted text into 200–1000 token chunks
- **Embedding generation** — Calls Gemini API with the user's key to create vectors
- **Vector storage** — Persists embeddings + metadata across sessions
- **Semantic similarity search** — Cosine similarity to find relevant chunks for a query
- **Answer generation** — Calls Gemini with retrieved context to produce cited answers
- **State persistence** — Indexed courses survive across browser sessions

The user's Gemini API key is passed through to Backboard.io, which uses it to make Gemini calls on their behalf — resulting in $0 server-side compute cost.

### Why this split?

Chrome extensions can't efficiently store vector databases or run similarity search at scale. By offloading RAG orchestration to Backboard.io, we keep the extension under 5MB, avoid IndexedDB performance issues with large embeddings, and get cross-session persistence for free.

## Tech Stack

- **Extension**: TypeScript, React, Chrome Manifest V3, Vite
- **AI**: Google Gemini (gemini-3.6-flash → 3.5-flash-lite → 2.5-flash-lite fallback chain)
- **Backend**: Backboard.io (RAG orchestration, vector store)
- **Testing**: Vitest, fast-check (property-based testing)

## Supported File Types

| Format | Extraction Method |
|--------|-------------------|
| PDF (.pdf) | PDF.js — page-level text with heading detection |
| PPTX (.pptx) | ZIP/XML — slide text from `<a:t>` tags |
| DOCX (.docx) | ZIP/XML — paragraph text with heading styles |
| DOC (.doc) | Best-effort binary text scan |
| ODT (.odt) | ZIP/XML — paragraphs and headings |
| HTML (.html) | DOM parsing with script/style removal |
| Jupyter (.ipynb) | JSON — markdown + code cells |
| Plain text (.txt, .md) | Read as-is |
| Source code (.py, .java, .js, .cpp, .css) | Read as-is |
| CSV (.csv) | Read as-is |

## Known Limitations

### What CourseChat cannot do (current version)

| Limitation | Reason | Planned Solution |
|------------|--------|------------------|
| **Cannot read diagrams, figures, or charts** | Images in PDFs/slides are stored as pixels, not text. Interpreting them requires a vision AI model (extra API calls, latency, quota burn). | On-demand diagram scanning: when text retrieval fails, offer a button to scan the specific page via Gemini Vision. One image at a time, user-controlled. |
| **Cannot process videos or audio** | Requires transcription (Whisper, etc.), which is out of scope for a browser extension. | Future: support pre-generated transcripts if uploaded alongside videos. |
| **Cannot read handwritten/scanned notes** | Scanned PDFs contain images of text, not actual text characters. PDF.js only extracts embedded text. | Same as diagrams — on-demand OCR via Gemini Vision. |
| **50MB per-file size limit** | Extension fetches files into browser memory. Large files would freeze the service worker or get killed by Chrome. | Covers 99% of lecture materials. Extremely large files (full textbooks) should be split by the uploader. |
| **Gemini free-tier rate limits** | ~1,500 requests/day shared across indexing and queries. Large courses may exhaust daily quota during initial indexing. | Multi-model fallback chain spreads load across 3 separate quota pools. Re-indexing resumes next day. |
| **Legacy .doc extraction is imperfect** | Binary OLE2 format without a full parser. Gets most text but may miss formatting or include noise. | Recommend converting .doc to .docx before uploading (most LMS platforms auto-convert anyway). |
| **No support for .xlsx, .ppt, .key, .zip archives** | Each requires a separate parser. Limited hackathon timeline. | Post-hackathon: add .xlsx (ZIP/XML) and .ppt (binary) support. |
| **Answers are limited to indexed course content** | By design — no web search, no hallucination beyond source material. | This is a feature, not a bug. If the answer isn't in the course material, the system says "insufficient information" rather than making things up. |
| **Single LMS platform (D2L Brightspace) at launch** | Platform adapter pattern supports multiple LMS, but only D2L is implemented for the hackathon. | Canvas adapter is architecturally ready — just needs DOM selectors for Canvas's page structure. |

### What CourseChat does well

- Indexes all text-based course documents automatically (no uploading, no manual work)
- Answers with exact citations (document name, page number, section heading)
- Works inside your existing LMS — no new app to open
- $0 cost — uses your free Gemini API key
- Supports 15 file formats covering CS, humanities, business, and STEM courses
- Multi-model fallback ensures availability even when primary model is rate-limited
- Course context isolation — each course has its own index, no cross-contamination

## Getting Started

```bash
git clone https://github.com/tridibbanik17/CUTC-Transform-Hackathon-2026.git
cd CUTC-Transform-Hackathon-2026
npm install
npm test
```

## Limits & Constraints

Now that Backboard.io handles the full RAG pipeline (chunking, embeddings, vector storage, generation), several client-side constraints have been relaxed:

| Constraint | Old Value | New Value | Rationale |
|------------|-----------|-----------|-----------|
| **Document content cap** | 80,000 characters (hard truncation) | No limit | Backboard handles chunking/embedding server-side — no need to cap extracted text locally |
| **Query input length** | 500 characters | 2,000 characters | Backboard's retrieval pipeline handles longer, more detailed queries effectively |
| **Answer word limit** | 300 words (hard truncation with ellipsis) | 1,000 words | Complex multi-part questions deserve thorough, cited answers |
| **Upload button** | Disabled at 80k chars ("Limit reached") | Always enabled (disabled only during active processing) | No local text budget to exhaust |

### Constraints that remain unchanged

| Constraint | Value | Reason |
|------------|-------|--------|
| **Per-file size** | 50 MB | Browser memory guard — large files would freeze the service worker |
| **Re-index timeout** | 15 minutes | Operational safeguard against runaway indexing |
| **Retry attempts** | 2 retries (Backboard & Gemini) | Network reliability — exponential backoff on 500/503 |
| **Gemini fallback chain** | 3 models deep | Rate-limit resilience across quota pools |

## Team

See [CONTRIBUTING.md](./CONTRIBUTING.md) for team assignments and workflow.
