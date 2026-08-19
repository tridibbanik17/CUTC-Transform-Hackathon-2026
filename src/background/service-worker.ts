// ============================================================
// Service Worker - Message Routing & Integration Wiring
// Routes messages between content script, side panel, and
// background modules. Gates operations behind API key check.
// ============================================================

import type { ServiceWorkerMessage } from '@/types/messages';
import { apiKeyManager } from './api-key-manager';
import { directGeminiQuery, getCourseContext, storeCourseContext } from './direct-gemini';
import { ragEngine, QueryValidationError, MissingApiKeyError } from './rag-engine';
import { indexingOrchestrator } from './indexing-orchestrator';

// --- Side Panel Registration ---

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// --- Message Handler ---

chrome.runtime.onMessage.addListener((message: ServiceWorkerMessage, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    sendResponse({ type: 'ERROR', payload: { message: err.message ?? 'Unknown error' } });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(
  message: ServiceWorkerMessage | { type: string; payload?: any },
  _sender: chrome.runtime.MessageSender
) {
  switch (message.type) {
    case 'GET_COURSE_INFO':
      return { type: 'COURSE_INFO_RESPONSE', payload: null };

    case 'PROCESS_QUERY':
      return processQuery(message.payload.courseId, message.payload.query);

    case 'GET_ACTIVE_PLATFORM':
      return { type: 'PLATFORM_DETECTED', payload: { platformName: null } };

    case 'GET_FALLBACK_STATUS':
      return getFallbackStatus();

    case 'VALIDATE_API_KEY':
      return validateApiKey(message.payload.key);

    case 'GET_API_KEY_STATUS':
      return getApiKeyStatus();

    case 'PARSE_PDF_UPLOAD':
      return parsePdfViaOffscreen((message as any).payload.base64, (message as any).payload.fileName);

    case 'PARSE_PDF':
      // This is handled by the offscreen document, not the service worker
      return undefined;

    case 'INDEX_EXTRACTED_TEXT':
      return indexExtractedText(
        message.payload.courseId,
        message.payload.fileName,
        message.payload.text
      );

    default:
      return { type: 'ERROR', payload: { message: 'Unknown message type' } };
  }
}

// --- Handler Implementations ---

async function processQuery(courseId: string, query: string) {
  // Gate behind API key
  const hasKey = await apiKeyManager.hasKey();
  if (!hasKey) {
    return { type: 'ERROR', payload: { message: 'No API key configured. Please add your Gemini API key in settings.', code: 'NO_API_KEY' } };
  }

  // Basic validation (kept identical to pre-integration behavior — the
  // side panel allows 1-char queries like "WBS", but rag-engine's
  // shared validateQuery() requires 3+ chars. Rather than silently
  // loosening src/shared/validation.ts — not my file to change without
  // flagging it — a query that's valid by this gate but rejected by
  // ragEngine's stricter check falls back to the direct-Gemini path
  // below instead of surfacing an error for something that used to work.)
  const trimmed = query.trim();
  if (trimmed.length < 1) {
    return { type: 'ERROR', payload: { message: 'Please type a question.', code: 'INVALID_QUERY' } };
  }
  if (trimmed.length > 2000) {
    return { type: 'ERROR', payload: { message: 'Query must be 2000 characters or fewer.', code: 'QUERY_TOO_LONG' } };
  }

  // --- Primary path: ragEngine -> Backboard.io (retrieval + generation) ---
  try {
    const result = await ragEngine.processQuery(courseId, trimmed);
    // 'retrieval_error' means Backboard itself failed (network/API
    // error) — fall through to the direct-Gemini fallback below rather
    // than surfacing a dead end, as long as we have local context to
    // fall back on.
    if (result.status !== 'retrieval_error') {
      return { type: 'QUERY_RESPONSE', payload: result };
    }
  } catch (err) {
    // QueryValidationError (e.g. a 1-2 char query the UI permits but
    // the shared validator doesn't) or MissingApiKeyError -> fall
    // through to direct-Gemini below rather than hard-failing.
    if (!(err instanceof QueryValidationError) && !(err instanceof MissingApiKeyError)) {
      return { type: 'ERROR', payload: { message: err instanceof Error ? err.message : 'Query failed.', code: 'RAG_ENGINE_ERROR' } };
    }
  }

  // --- Fallback path: direct Gemini call over locally cached context ---
  // Used when Backboard is unreachable, or ragEngine rejected the query
  // on a rule the UI itself doesn't enforce (see comment above).
  const apiKey = await apiKeyManager.getKey();
  if (!apiKey) {
    return { type: 'ERROR', payload: { message: 'Failed to retrieve API key.', code: 'KEY_ERROR' } };
  }

  const context = await getCourseContext(courseId);
  if (!context) {
    // Fallback: try reconstructing from individual stored file texts
    const filesResult = await chrome.storage.local.get('course_files_default-course');
    const fileNames: string[] = filesResult['course_files_default-course'] || [];
    if (fileNames.length === 0) {
      return { type: 'ERROR', payload: { message: 'Please upload at least one PDF or file first.', code: 'NO_INDEX' } };
    }
    const keys = fileNames.map(f => `file_text_${f}`);
    const texts = await chrome.storage.local.get(keys);
    let rebuilt = '';
    for (const f of fileNames) {
      const text = texts[`file_text_${f}`] || '';
      if (text) rebuilt += `\n\n[${f}]\n${text}`;
    }
    if (!rebuilt) {
      return { type: 'ERROR', payload: { message: 'Please upload at least one PDF or file first.', code: 'NO_INDEX' } };
    }
    // Store it for next time
    chrome.storage.local.set({ [`course_context_${courseId}`]: rebuilt }).catch(() => {});
    const result = await directGeminiQuery(apiKey, trimmed, rebuilt, courseId);
    return {
      type: 'QUERY_RESPONSE',
      payload: {
        answer: result.answer,
        citations: result.citations,
        confidenceScore: result.status === 'success' ? 0.8 : 0.3,
        status: result.status,
      },
    };
  }

  const result = await directGeminiQuery(apiKey, trimmed, context, courseId);

  return {
    type: 'QUERY_RESPONSE',
    payload: {
      answer: result.answer,
      citations: result.citations,
      confidenceScore: result.status === 'success' ? 0.8 : 0.3,
      status: result.status,
    },
  };
}

async function getFallbackStatus() {
  // TODO: Wire to Gemini wrapper (Task 6) when complete
  return {
    type: 'FALLBACK_STATUS_RESPONSE',
    payload: { exhausted: false, lastUsedModel: 'gemini-3.6-flash' },
  };
}

async function validateApiKey(key: string) {
  const result = await apiKeyManager.validateKey(key);
  if (result.valid) {
    await apiKeyManager.storeKey(key);
  }
  return {
    type: 'API_KEY_STATUS_RESPONSE',
    payload: { hasKey: result.valid, maskedKey: result.valid ? await apiKeyManager.getMaskedKey() : null },
  };
}

async function getApiKeyStatus() {
  const hasKey = await apiKeyManager.hasKey();
  const maskedKey = hasKey ? await apiKeyManager.getMaskedKey() : null;
  return {
    type: 'API_KEY_STATUS_RESPONSE',
    payload: { hasKey, maskedKey },
  };
}

async function parsePdfViaOffscreen(base64: string, fileName: string) {
  // Create offscreen document if it doesn't exist
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Parse PDF text with PDF.js',
    });
  } catch {
    // Already exists — that's fine
  }

  // Wait a moment for the offscreen document to load PDF.js
  await new Promise(r => setTimeout(r, 2000));

  // Send PDF data to offscreen document for parsing
  try {
    const result = await chrome.runtime.sendMessage({ type: 'PARSE_PDF', data: base64 });
    if (result?.success && result.text) {
      // Store the extracted text
      await storeCourseContext('default-course', result.text.slice(0, 100000));
      return { payload: { text: result.text, error: null } };
    } else {
      return { payload: { text: '', error: result?.error || 'PDF parsing failed' } };
    }
  } catch (err) {
    return { payload: { text: '', error: err instanceof Error ? err.message : 'Unknown error' } };
  }
}



async function indexExtractedText(courseId: string, fileName: string, text: string) {
  // Gate behind API key, same as every other Backboard-touching handler.
  const hasKey = await apiKeyManager.hasKey();
  if (!hasKey) {
    return { type: 'ERROR', payload: { message: 'No API key configured. Please add your Gemini API key in settings.', code: 'NO_API_KEY' } };
  }

  const apiKey = await apiKeyManager.getKey();
  if (!apiKey) {
    return { type: 'ERROR', payload: { message: 'Failed to retrieve API key.', code: 'KEY_ERROR' } };
  }

  // Best-effort: indexing into Backboard is additive on top of the
  // side panel's existing local-storage fallback path, so a failure
  // here is reported but does not throw — the locally cached text
  // (stored separately by the side panel) still powers the direct-
  // Gemini fallback in processQuery() if Backboard is unreachable.
  try {
    const result = await indexingOrchestrator.indexExtractedDocuments({
      courseId,
      apiKey,
      documents: [{ fileName, text }],
    });
    return { type: 'INDEXING_COMPLETE', payload: result };
  } catch (err) {
    return {
      type: 'INDEXING_COMPLETE',
      payload: {
        success: false,
        documentsIndexed: 0,
        chunksCreated: 0,
        failures: [{ fileName, error: err instanceof Error ? err.message : 'Backboard indexing failed.' }],
      },
    };
  }
}


