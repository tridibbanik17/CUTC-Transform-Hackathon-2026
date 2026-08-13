// ============================================================
// Service Worker - Message Routing & Integration Wiring
// Routes messages between content script, side panel, and
// background modules. Gates operations behind API key check.
// ============================================================

import type { ServiceWorkerMessage } from '@/types/messages';
import { apiKeyManager } from './api-key-manager';
import { directGeminiQuery, getCourseContext, storeCourseContext } from './direct-gemini';

/**
 * Extract readable text strings from raw PDF bytes.
 * PDFs store text in streams — this finds parenthesized strings (Tj/TJ operators)
 * and Unicode text. Not perfect but captures most readable content.
 */
function extractTextFromPdfBytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(bytes);

  // Extract text from PDF text operators: (text) Tj and [(text)] TJ
  const tjMatches = text.match(/\(([^)]{2,})\)/g) || [];
  for (const match of tjMatches) {
    const inner = match.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    
    // Only keep strings that look like real text (has letters/numbers)
    if (inner.match(/[a-zA-Z0-9]{2,}/) && inner.length >= 2) {
      chunks.push(inner);
    }
  }

  // Also try to find BT...ET text blocks with readable content
  const btBlocks = text.match(/BT[\s\S]{1,5000}?ET/g) || [];
  for (const block of btBlocks) {
    const blockTexts = block.match(/\(([^)]{2,})\)/g) || [];
    for (const bt of blockTexts) {
      const inner = bt.slice(1, -1);
      if (inner.match(/[a-zA-Z0-9]{2,}/)) {
        // Already captured above, skip duplicates
      }
    }
  }

  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

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

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { type: 'ERROR', payload: { message: 'No active tab found.', code: 'NO_TAB' } };
  }

  // Refresh the page to ensure clean state
  await chrome.tabs.reload(tab.id);
  
  // Wait for page to fully load
  await new Promise<void>((resolve) => {
    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout after 10s in case the event doesn't fire
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
  });

  // Extra wait for D2L to finish rendering dynamic content
  await new Promise(r => setTimeout(r, 2000));

  // Ask content script for page text and PDF URLs
  let pageText = '';
  let pdfUrls: string[] = [];
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_TEXT' });
    pageText = res?.payload?.text ?? '';
    pdfUrls = res?.payload?.pdfUrls ?? [];
  } catch {
    // Content script not available — use scripting to auto-scroll and extract
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body.innerText,
      });
      pageText = result?.result ?? '';
    } catch {
      return { type: 'ERROR', payload: { message: 'Cannot access page content.', code: 'ACCESS_DENIED' } };
    }
  }

  // If page text is low, try using scripting API to auto-scroll and re-extract
  if (pageText.length < 15000) {
    try {
      // First scroll the main frame
      const [mainResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          const scrollables: Element[] = [];
          document.querySelectorAll('*').forEach((el) => {
            if (el.scrollHeight > el.clientHeight + 100) {
              const style = window.getComputedStyle(el);
              if (style.overflow === 'auto' || style.overflow === 'scroll' ||
                  style.overflowY === 'auto' || style.overflowY === 'scroll') {
                scrollables.push(el);
              }
            }
          });
          for (const el of scrollables) {
            const orig = el.scrollTop;
            const height = el.scrollHeight;
            for (let pos = 0; pos < height; pos += 200) {
              el.scrollTop = pos;
              await new Promise(r => setTimeout(r, 200));
            }
            el.scrollTop = orig;
          }
          const origMain = document.documentElement.scrollTop;
          for (let pos = 0; pos < document.documentElement.scrollHeight; pos += 200) {
            document.documentElement.scrollTop = pos;
            await new Promise(r => setTimeout(r, 200));
          }
          document.documentElement.scrollTop = origMain;
          await new Promise(r => setTimeout(r, 500));
          return document.body.innerText || '';
        },
      });

      // Then scroll all sub-frames (iframes) separately
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: async () => {
            // Only scroll if this is NOT the top frame
            if (window === window.top) return '';
            const scrollables: Element[] = [];
            document.querySelectorAll('*').forEach((el) => {
              if (el.scrollHeight > el.clientHeight + 100) {
                const style = window.getComputedStyle(el);
                if (style.overflow === 'auto' || style.overflow === 'scroll' ||
                    style.overflowY === 'auto' || style.overflowY === 'scroll') {
                  scrollables.push(el);
                }
              }
            });
            for (const el of scrollables) {
              const orig = el.scrollTop;
              for (let pos = 0; pos < el.scrollHeight; pos += 200) {
                el.scrollTop = pos;
                await new Promise(r => setTimeout(r, 250));
              }
              el.scrollTop = orig;
            }
            // Also scroll the frame's document itself
            const orig = document.documentElement.scrollTop;
            for (let pos = 0; pos < document.documentElement.scrollHeight; pos += 200) {
              document.documentElement.scrollTop = pos;
              await new Promise(r => setTimeout(r, 250));
            }
            document.documentElement.scrollTop = orig;
            return '';
          },
        });
      } catch {
        // allFrames may fail on cross-origin frames — that's OK
      }

      // Wait for renders after iframe scrolling
      await new Promise(r => setTimeout(r, 2000));

      // Now collect text from main frame
      const [textResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body.innerText || '',
      });

      const scrolledText = textResult?.result ?? mainResult?.result ?? '';
      if (scrolledText.length > pageText.length) {
        pageText = scrolledText;
      }
    } catch {
      // Ignore scripting failures
    }
  }

  let allText = pageText;

  // If we found PDF URLs, fetch and extract text from them
  if (pdfUrls.length > 0) {
    for (const pdfUrl of pdfUrls.slice(0, 3)) {
      try {
        const response = await fetch(pdfUrl, { credentials: 'include' });
        if (!response.ok) continue;
        
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('html') || contentType.includes('text')) {
          const htmlText = await response.text();
          const stripped = htmlText.replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (stripped.length > 200) {
            allText += '\n\n--- Document ---\n' + stripped;
          }
        } else if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
          // Extract readable ASCII strings from PDF binary
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const pdfText = extractTextFromPdfBytes(bytes);
          if (pdfText.length > 100) {
            allText += '\n\n--- PDF Document ---\n' + pdfText;
          }
        }
      } catch {
        // Skip failed fetches
      }
    }
  }

  if (allText.trim().length < 50) {
    return { type: 'ERROR', payload: { message: 'Not enough text content found on this page to index.', code: 'NO_CONTENT' } };
  }

  // Store context (cap at 100k chars for Gemini context window)
  const contextToStore = allText.slice(0, 100000);
  await storeCourseContext(courseId, contextToStore);

  return {
    type: 'INDEXING_COMPLETE',
    payload: { success: true, documentsIndexed: 1, chunksCreated: 1, failures: [], _contextLength: contextToStore.length },
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

  // Get API key and course context
  const apiKey = await apiKeyManager.getKey();
  if (!apiKey) {
    return { type: 'ERROR', payload: { message: 'Failed to retrieve API key.', code: 'KEY_ERROR' } };
  }

  const context = await getCourseContext(courseId);
  if (!context) {
    return { type: 'ERROR', payload: { message: 'No course has been indexed yet. Click "Index Course" first.', code: 'NO_INDEX' } };
  }

  // Direct Gemini query (demo mode — bypasses Backboard.io)
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
