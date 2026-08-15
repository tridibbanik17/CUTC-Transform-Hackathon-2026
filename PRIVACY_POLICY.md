# Privacy Policy for CourseChat

**Last updated:** August 15, 2026

## Overview

CourseChat is a Chrome extension that helps students study by indexing their course materials and answering questions with cited sources. We are committed to protecting your privacy.

## Data Collection and Usage

### What we collect

CourseChat processes the following data:

1. **Course materials you upload** — PDFs, documents, slides, and other files you choose to upload are processed to extract text content.
2. **Your questions** — The queries you type into the extension are sent to our backend for answer generation.
3. **Your Gemini API key** — Stored locally in your browser's storage to authenticate with Google's Gemini API.

### How data is processed

- **Extracted text** from your uploaded files is sent to Backboard.io, our RAG (Retrieval-Augmented Generation) backend, for chunking, embedding, and answer generation.
- **Your Gemini API key** is passed to Backboard.io, which uses it to make Google Gemini API calls on your behalf for embedding generation and answer creation.
- **Your questions** are processed through Backboard.io to retrieve relevant context and generate answers.

### What we do NOT collect

- We do not collect personal information (name, email, address).
- We do not track your browsing history or activity outside the extension.
- We do not use cookies or tracking technologies.
- We do not sell, share, or transfer your data to third parties for advertising.
- We do not collect analytics or telemetry data.

## Data Storage

- **Local storage:** Your API key, chat history, uploaded file text, and preferences are stored locally in your browser using Chrome's storage APIs. This data never leaves your device except as described above.
- **Server-side:** Backboard.io processes your course text and queries to generate embeddings and answers. Data is associated with your API key for course isolation purposes.
- **No account required:** CourseChat does not require you to create an account or provide any personal information.

## Data Retention

- **Local data:** Remains on your device until you clear it using the "Clear Files" button or uninstall the extension.
- **Server-side data:** Indexed course embeddings persist on Backboard.io to enable cross-session retrieval. You can delete your indexed data at any time through the extension.

## Third-Party Services

CourseChat uses the following third-party services:

1. **Backboard.io** — RAG orchestration backend (chunking, embeddings, vector search, answer generation). [Backboard.io Privacy Policy](https://backboard.io/privacy)
2. **Google Gemini API** — AI model for text generation and embeddings. Called via your own API key. [Google AI Privacy](https://ai.google.dev/terms)

## Data Security

- Your API key is stored in Chrome's secure local storage and is never exposed to web pages.
- All communication with Backboard.io and Google Gemini API uses HTTPS encryption.
- Course materials are isolated per API key — no cross-user data access is possible.

## Children's Privacy

CourseChat is designed for students of all ages. We do not knowingly collect personal information from children under 13. The extension processes only academic course materials that users explicitly upload.

## Your Rights

You can:
- **View** your stored data through the file preview feature.
- **Delete** individual files, chat history, or all stored data at any time.
- **Remove** your API key from the extension at any time.
- **Uninstall** the extension to remove all local data completely.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last updated" date above. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact

For privacy-related questions or concerns, please open an issue on our GitHub repository:
https://github.com/tridibbanik17/CUTC-Transform-Hackathon-2026

## Permissions Explained

| Permission | Why it's needed |
|-----------|----------------|
| `storage` | Store your API key, chat history, and extracted file text locally |
| `unlimitedStorage` | Allow indexing large courses (textbooks, many files) without hitting Chrome's default 10MB cap |
| `activeTab` | Detect the current page for future LMS auto-detection features |
| `scripting` | Enable voice input and page interaction features |
| `sidePanel` | Render the CourseChat interface in Chrome's side panel |
| `offscreen` | Run PDF.js text extraction in a sandboxed context |
