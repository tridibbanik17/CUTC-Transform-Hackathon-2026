// ============================================================
// Service Worker - Message Routing & Integration Wiring
// Routes messages between content script, side panel, and
// background modules. Gates operations behind API key check.
// ============================================================

import type { ServiceWorkerMessage } from '@/types/messages';
import { apiKeyManager } from './api-key-manager';

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
  message: ServiceWorkerMessage,
  _sender: chrome.runtime.MessageSender
) {
  switch (message.type) {
    case 'GET_COURSE_INFO':
      return getCourseInfo();

    case 'START_INDEXING':
      return startIndexing(message.payload.courseId);

    case 'PROCESS_QUERY':
      return processQuery(message.payload.courseId, message.payload.query);

    case 'GET_INDEX_STATUS':
      return getIndexStatus(message.payload.courseId);

    case 'DELETE_COURSE_DATA':
      return deleteCourseData(message.payload.courseId);

    case 'RE_INDEX':
      return reIndex(message.payload.courseId);

    case 'GET_ACTIVE_PLATFORM':
      return getActivePlatform();

    case 'GET_FALLBACK_STATUS':
      return getFallbackStatus();

    case 'VALIDATE_API_KEY':
      return validateApiKey(message.payload.key);

    case 'GET_API_KEY_STATUS':
      return getApiKeyStatus();

    default:
      return { type: 'ERROR', payload: { message: 'Unknown message type' } };
  }
}

// --- Handler Implementations (stubs wired to real modules as they're completed) ---

async function getCourseInfo() {
  // Delegates to content script via tabs.sendMessage
  // Will be wired when platform adapter (Task 3) is complete
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { type: 'COURSE_INFO_RESPONSE', payload: null };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_COURSE_INFO' });
    return { type: 'COURSE_INFO_RESPONSE', payload: response?.payload ?? null };
  } catch {
    return { type: 'COURSE_INFO_RESPONSE', payload: null };
  }
}

async function startIndexing(courseId: string) {
  // Gate behind API key
  const hasKey = await apiKeyManager.hasKey();
  if (!hasKey) {
    return { type: 'ERROR', payload: { message: 'No API key configured. Please add your Gemini API key in settings.', code: 'NO_API_KEY' } };
  }

  // TODO: Wire to indexing orchestrator (Task 10) when complete
  // For now, return a placeholder response
  return {
    type: 'INDEXING_COMPLETE',
    payload: { success: false, documentsIndexed: 0, chunksCreated: 0, failures: [{ fileName: 'N/A', error: 'Indexing not yet implemented' }] },
  };
}

async function processQuery(courseId: string, query: string) {
  // Gate behind API key
  const hasKey = await apiKeyManager.hasKey();
  if (!hasKey) {
    return { type: 'ERROR', payload: { message: 'No API key configured. Please add your Gemini API key in settings.', code: 'NO_API_KEY' } };
  }

  // Basic validation
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return { type: 'ERROR', payload: { message: 'Query must be at least 3 characters.', code: 'INVALID_QUERY' } };
  }
  if (trimmed.length > 500) {
    return { type: 'ERROR', payload: { message: 'Query must be 500 characters or fewer.', code: 'QUERY_TOO_LONG' } };
  }

  // TODO: Wire to RAG engine (Task 8) when complete
  return {
    type: 'QUERY_RESPONSE',
    payload: { answer: '', citations: [], confidenceScore: 0, status: 'retrieval_error' as const },
  };
}

async function getIndexStatus(courseId: string) {
  // Gate behind API key
  const hasKey = await apiKeyManager.hasKey();
  if (!hasKey) {
    return { type: 'ERROR', payload: { message: 'No API key configured.', code: 'NO_API_KEY' } };
  }

  // TODO: Wire to backboard client getCourseStatus when complete
  return {
    type: 'INDEX_STATUS_RESPONSE',
    payload: { status: 'not_indexed' as const, documentCount: 0, chunkCount: 0 },
  };
}

async function deleteCourseData(courseId: string) {
  const hasKey = await apiKeyManager.hasKey();
  if (!hasKey) {
    return { type: 'ERROR', payload: { message: 'No API key configured.', code: 'NO_API_KEY' } };
  }

  // TODO: Wire to backboard client deleteCourse when complete
  return { type: 'INDEX_STATUS_RESPONSE', payload: { status: 'not_indexed' as const, documentCount: 0, chunkCount: 0 } };
}

async function reIndex(courseId: string) {
  const hasKey = await apiKeyManager.hasKey();
  if (!hasKey) {
    return { type: 'ERROR', payload: { message: 'No API key configured.', code: 'NO_API_KEY' } };
  }

  // TODO: Wire to indexing orchestrator re-index flow (Task 10) when complete
  return {
    type: 'INDEXING_COMPLETE',
    payload: { success: false, documentsIndexed: 0, chunksCreated: 0, failures: [{ fileName: 'N/A', error: 'Re-indexing not yet implemented' }] },
  };
}

async function getActivePlatform() {
  // Ask the content script which adapter is active
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { type: 'PLATFORM_DETECTED', payload: { platformName: null } };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ACTIVE_PLATFORM' });
    return { type: 'PLATFORM_DETECTED', payload: { platformName: response?.payload?.platformName ?? null } };
  } catch {
    return { type: 'PLATFORM_DETECTED', payload: { platformName: null } };
  }
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
