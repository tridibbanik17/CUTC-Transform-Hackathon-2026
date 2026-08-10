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

## Getting Started

```bash
git clone https://github.com/tridibbanik17/CUTC-Transform-Hackathon-2026.git
cd CUTC-Transform-Hackathon-2026
npm install
npm test
```

## Team

See [CONTRIBUTING.md](./CONTRIBUTING.md) for team assignments and workflow.
