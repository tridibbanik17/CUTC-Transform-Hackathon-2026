# Team Collaboration Guide

## Team Members & Responsibilities

| Member | GitHub Handle | Role | Assigned Issues |
|--------|--------------|------|-----------------|
| **Tridib** | @tridibbanik17 | Architecture & Integration | #2, #3, #4, #5, #6 |
| **Taksh** | @takshp2024-sys | AI/Backend Logic | #7, #8, #9 |
| **Bhagya** | @BhagyaV3 | Frontend/UI | #10, #11, #12 |
| **Hunza** | @huna-mathophile | Data Pipeline | #13, #14 |

---

## Branching Strategy

We use **feature branches + PRs to main**. Never push directly to main.

### Branch naming convention

```
<your-name>/<short-description>
```

Examples:
```
tridib/scaffolding
tridib/backboard-client
taksh/gemini-wrapper
taksh/rag-engine
bhagya/side-panel-ui
hunza/platform-adapters
hunza/document-processor
```

### Workflow per task

1. `git checkout main && git pull origin main`
2. `git checkout -b your-name/task-description`
3. Do your work, commit often
4. `git push -u origin your-name/task-description`
5. Open a PR to `main` on GitHub
6. Self-merge (no review needed for hackathon pace — unless touching shared files)
7. Delete the branch after merge

---

## Execution Order (Wave-Based)

Tasks have dependencies. Follow this order — each wave can only start after the previous wave's tasks are merged to main.

### Wave 1 — Foundation (Tridib only)

| Person | Issue | Task |
|--------|-------|------|
| Tridib | #2 | Project scaffolding, TypeScript interfaces, IndexedDB schema |

> ⚠️ **Everyone is blocked until Wave 1 merges.** This creates the project structure and shared types that all other tasks depend on.

### Wave 2 — Core Modules (All 4 in parallel)

| Person | Issue | Task | Branch |
|--------|-------|------|--------|
| Tridib | #3 | API Key Manager (BYOK) | `tridib/api-key-manager` |
| Hunza | #13 | Platform adapters + D2L Brightspace | `hunza/platform-adapters` |
| Taksh | #7 | Gemini API Wrapper + fallback chain | `taksh/gemini-wrapper` |
| Bhagya | — | Start designing UI layout/CSS (can use mock data) | `bhagya/ui-design` |

### Wave 3 — Feature Implementation (All 4 in parallel)

| Person | Issue | Task | Depends on |
|--------|-------|------|-----------|
| Hunza | #14 | Content scraper + document processor | #13 (adapters) |
| Tridib | #4 | Backboard.io client | #3 (API key manager) |
| Taksh | #8 | RAG engine + query processing | #7 (Gemini wrapper) |
| Bhagya | #10 | Side panel shell, header, settings, indexing UI | #3 (API key interface) |

### Wave 4 — Orchestration & UI Completion

| Person | Issue | Task | Depends on |
|--------|-------|------|-----------|
| Taksh | #9 | Indexing orchestrator + progress tracking | #14, #4 |
| Bhagya | #11, #12 | Query panel, answers, onboarding, notifications | #8 (RAG types) |
| Tridib | #5 | Service worker message routing | #4, #8 |
| Hunza | — | Help with tests or start Canvas adapter | — |

### Wave 5 — Final Integration (Everyone)

| Person | Issue | Task |
|--------|-------|------|
| Tridib | #6 | Final integration, build pipeline, E2E wiring |
| Everyone | — | Integration testing, bug fixes, polish |

---

## Ground Rules

1. **Pull from main before starting each wave** — keeps everyone in sync
2. **Don't modify `src/types/index.ts` without notifying the group** — that file is shared by everyone. Post in the group chat before changing interfaces.
3. **Merge scaffolding (Wave 1) first** — nothing works until the project structure exists
4. **Use small, frequent PRs** — one per sub-task is fine
5. **If you're blocked, ping in the group chat** — don't wait silently
6. **No local vector store code** — Wave 1 scaffolding sets up IndexedDB for session/preferences ONLY. All vector storage, chunking, and embeddings are on Backboard.io. Do not build client-side vector search.
7. **OCR/Vision routing** — Hunza's document processor detects text-less pages and routes them through Taksh's Gemini wrapper for OCR/Vision. Coordinate on the interface between these two components.

---

## Quick Git Commands

```bash
# Start a new task
git checkout main
git pull origin main
git checkout -b your-name/task-name

# Save progress
git add .
git commit -m "feat: description of what you did"
git push -u origin your-name/task-name

# Create PR (via GitHub CLI)
gh pr create --title "Task X: Short description" --base main

# After PR is merged, clean up
git checkout main
git pull origin main
git branch -d your-name/task-name
```

---

## Tech Stack Reference

- **Runtime:** Chrome Extension (Manifest V3)
- **Language:** TypeScript
- **UI:** React (Side Panel API)
- **Build:** Vite
- **Backend:** Backboard.io API (server-side RAG)
- **AI:** Google Gemini API (BYOK — user provides key)
- **Testing:** Vitest + fast-check (property-based)
- **Models:** gemini-3.6-flash → gemini-3.5-flash-lite → gemini-2.5-flash-lite

---

## Key Architecture Notes

- **No local vector store** — all chunking, embeddings, and RAG happen on Backboard.io
- **IndexedDB** is only for session history, preferences, and adapter state
- **API keys** are stored in `chrome.storage.local` (not IndexedDB)
- **Document extraction** (PDF.js, PPTX) happens locally in the extension, then text is sent to Backboard.io
- **Fallback chain** catches HTTP 404 (deprecated) and 429 (rate limit) to auto-advance models
