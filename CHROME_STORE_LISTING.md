# Chrome Web Store Listing Guide

## Extension Name
CourseChat

## Short Description (132 characters max)
Upload your course materials, ask questions, get cited answers. AI study tutor powered by your free Gemini API key. $0 cost.

## Detailed Description (for store listing)

CourseChat turns your course materials into an AI-powered study tutor — right in your browser.

HOW IT WORKS:
1. Get a free Gemini API key from Google AI Studio
2. Upload your course files (lectures, assignments, exams, slides, textbooks)
3. Ask questions in plain English
4. Get accurate, cited answers pointing to exact pages and sections

FEATURES:
• Answers cite the exact source document, page number, and section
• Upload entire courses — no file size limits or character caps
• Supports 15+ file formats: PDF, PPTX, DOCX, DOC, ODT, HTML, Jupyter notebooks, plain text, source code, LaTeX, and more
• Drag & drop files — upload one or many files by dropping them into the panel
• Math renders cleanly with Unicode (no raw LaTeX clutter)
• Dark mode and light mode
• Export your Q&A sessions as Markdown
• Copy or listen to answers with one click
• File preview — click any uploaded file to see extracted text
• Works with any course, any subject, any school

ZERO COST:
CourseChat uses your own free Google Gemini API key. There are no subscriptions, no premium tiers, and no hidden fees. You bring your key, we bring the RAG pipeline.

HOW IT'S DIFFERENT:
Unlike ChatGPT or other AI tools, CourseChat ONLY answers from your uploaded materials. It won't hallucinate or make things up. If the answer isn't in your course content, it tells you so.

PRIVACY:
• Your files are processed for text extraction and answer generation only
• No personal data collected, no tracking, no ads
• Your API key stays in your browser's local storage
• Course materials are isolated — no cross-user access

SUPPORTED FILE TYPES:
PDF, PPTX, DOCX, DOC, ODT, HTML, Jupyter (.ipynb), TXT, Markdown, Python, Java, JavaScript, C++, C, CSS, CSV, MATLAB (.m), LaTeX (.tex)

GETTING STARTED:
1. Click the CourseChat icon in your toolbar to open the side panel
2. Click the gear icon to paste your free Gemini API key (get one at aistudio.google.com/apikey)
3. Upload your course files (click the Upload button or drag & drop files into the panel)
4. Start asking questions!

Built by students, for students.

---

## Category
**Education** (primary)

Alternative: Productivity

---

## Language
English

---

## Permission Justifications (for Chrome review)

| Permission | Justification |
|-----------|---------------|
| `storage` | Stores the user's API key, chat history, uploaded file text, and UI preferences (dark mode) locally in the browser. No data is sent externally except as described in the privacy policy. |
| `unlimitedStorage` | Allows students to index entire courses (multiple textbooks, 40+ lecture files) without hitting Chrome's default 10MB storage limit. All data remains local. |
| `sidePanel` | The extension's primary UI renders in Chrome's native side panel, providing a study assistant alongside the user's current webpage. |
| `offscreen` | Creates an offscreen document to run PDF.js text extraction in a sandboxed iframe, preventing interference with the active page. |

---

## Single Purpose Description
"AI-powered study assistant that answers questions from user-uploaded course materials with cited sources."

---

## Privacy Practices (Chrome Web Store form)

**Does your extension collect or use user data?** Yes

**Data types collected:**
- ✅ User activity (queries typed into the extension)
- ✅ Website content (only when user explicitly uploads files)

**Certify the following:**
- ✅ Data usage aligns with the extension's single purpose
- ✅ Data is not sold to third parties
- ✅ Data is not used for purposes unrelated to the extension's core functionality
- ✅ Data is not used for creditworthiness or lending purposes

---

## Screenshots Order (in store_screenshots/ folder)
1. Solving_Midterm_Questions_requiring_Math.png — Shows math rendering + citations
2. Indexing_Many_Files.png — Shows 40+ files indexed
3. Answering_big_questions.png — Shows detailed multi-part answer
4. Preview_of_what_text_is_captured_from_an_uploaded_file.png — Shows file preview
5. Export_All_Chats.png — Shows export feature

---

## Tips for Getting the Featured Badge

Chrome's Featured badge requires:

1. **Follow all Chrome Web Store policies** — no policy violations
2. **Complete store listing** — all fields filled, good screenshots, privacy policy linked
3. **Good user experience:**
   - Fast load time (side panel is instant)
   - Clear onboarding (welcome message guides key setup)
   - Accessible (keyboard nav, readable fonts)
4. **Technical best practices:**
   - Manifest V3 (you're already on it)
   - Minimal permissions (justify each one)
   - No remote code execution
   - Content Security Policy compliance
5. **User ratings and reviews** — once published, get early users to rate it
6. **Regular updates** — show active maintenance

What to AVOID (rejection reasons):
- ❌ Keyword stuffing in the description
- ❌ Misleading screenshots
- ❌ Requesting permissions you don't use
- ❌ Missing privacy policy
- ❌ Generic or copied descriptions

---

## Privacy Policy URL
Host the PRIVACY_POLICY.md on GitHub Pages or link directly to:
https://github.com/tridibbanik17/CUTC-Transform-Hackathon-2026/blob/main/PRIVACY_POLICY.md

---

## Demo Video URL
https://youtu.be/3ZYDVrsDuRY?si=1XWbaEdmz7IW3V65

---

## Demo Video Tips (for store listing YouTube link)

**Length:** 30-60 seconds (max 90 seconds)

**Structure:**
1. (0-5s) Show the extension icon → click → side panel opens
2. (5-15s) Paste API key → show it validates
3. (15-30s) Upload 3-4 PDF files → show progress bar → "Ready to answer"
4. (30-50s) Ask a question → show the answer with inline citations
5. (50-60s) Show one more question (math-heavy) → clean Unicode rendering
6. (optional 60-90s) Quick flash of dark mode, file preview, export

**Tips:**
- No narration needed (most store users watch muted) — use on-screen captions/annotations
- Record at 1920x1080, upload as 1080p
- Show real course content (your OS chapters work great)
- Keep it fast-paced — no waiting, no dead time (speed up API response wait)
- End with the extension icon + URL so users know how to install
