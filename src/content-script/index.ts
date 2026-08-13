// ============================================================
// Content Script - Injected into all pages
// Detects LMS platform, extracts course info, and provides
// page text + PDF URLs for indexing.
//
// Platform detection is delegated to the shared AdapterRegistry
// (src/platform/index.ts) so D2L Brightspace, Canvas, Moodle,
// and Google Classroom are all recognized here — previously
// this file only ever recognized D2L via an inline URL check,
// which is why the side panel appeared permanently "stuck" on
// the unsupported-page message for every other platform.
// ============================================================

import { platformRegistry } from '@/platform';
import type { PlatformAdapter } from '@/types';

let activeAdapter: PlatformAdapter | null = null;
let activePlatformName: string | null = null;
let detectedCourseId: string | null = null;
let detectedCourseName: string | null = null;
let lastKnownUrl = '';

/**
 * Detect which LMS platform (if any) is active for the current page via
 * the shared AdapterRegistry, and extract course metadata through the
 * matched adapter. Safe to call repeatedly (initial load, `load` event,
 * SPA navigation) — every step is defensively wrapped so a DOM query
 * failure or a missing element never throws out of this function.
 */
function detectPlatform(): void {
  const url = window.location.href;
  lastKnownUrl = url;

  try {
    activeAdapter = platformRegistry.detectPlatform(url);
  } catch {
    activeAdapter = null;
  }

  activePlatformName = activeAdapter?.name ?? null;

  if (!activeAdapter) {
    detectedCourseId = null;
    detectedCourseName = null;
    notifySidePanel();
    return;
  }

  let isCourse = false;
  try {
    isCourse = activeAdapter.isCoursePage(document);
  } catch {
    isCourse = false;
  }

  if (!isCourse) {
    detectedCourseId = null;
    detectedCourseName = null;
    notifySidePanel();
    return;
  }

  try {
    detectedCourseId = activeAdapter.extractCourseId(url);
  } catch {
    detectedCourseId = null;
  }
  try {
    detectedCourseName = activeAdapter.extractCourseName(document);
  } catch {
    detectedCourseName = null;
  }

  // Extra safety net on top of each adapter's own `extractCourseName`
  // fallback: if extraction still comes back null/empty for any reason,
  // try to salvage a course name from `document.title` (skipping the
  // generic "Google Classroom" title segment some pages use).
  try {
    if (!detectedCourseName && document.title) {
      const titleParts = document.title.split('-');
      const firstPart = titleParts[0]?.trim();
      if (firstPart && firstPart !== 'Google Classroom') {
        detectedCourseName = firstPart;
      }
    }
  } catch {
    // document.title access failed — leave detectedCourseName as-is.
  }

  notifySidePanel();
}

/**
 * Push the current platform-detection status out immediately so the side
 * panel updates in real time instead of waiting for its next poll. This
 * reaches both the service worker and any open side panel/popup page that
 * has registered a `chrome.runtime.onMessage` listener.
 *
 * Defensively wrapped: `chrome.runtime.sendMessage` can throw synchronously
 * (e.g. during a page navigation/unload when the extension context is
 * being torn down) or reject if there is currently no listener — neither
 * case should ever surface as an uncaught error in the page.
 */
function notifySidePanel(): void {
  try {
    chrome.runtime
      .sendMessage({
        type: 'CONTENT_PLATFORM_DETECTED',
        payload: {
          platformName: activePlatformName,
          courseId: detectedCourseId,
          // Platform-agnostic fallback — must not hardcode a Classroom-
          // specific string here, since this payload is sent for every
          // supported LMS (D2L, Canvas, Moodle, Blackboard, Classroom).
          courseName: detectedCourseName ?? 'Unknown Course',
          isSupported: !!activeAdapter,
          url: window.location.href,
        },
      })
      .catch(() => {
        // No listener currently attached — ignore.
      });
  } catch {
    // Ignore error mid-navigation
  }
}
// --- Initial detection ---
detectPlatform();

// Re-run detection once the page has fully finished loading — some LMS
// pages render their header/course-name DOM asynchronously, so the very
// first pass (at document_idle) can miss elements that appear moments later.
if (document.readyState === 'complete') {
  detectPlatform();
} else {
  window.addEventListener('load', detectPlatform, { once: true });
}

/** Re-detect the platform/course if the page URL has actually changed. */
function handlePossibleNavigation(): void {
  if (window.location.href !== lastKnownUrl) {
    detectPlatform();
  }
}

// --- SPA navigation detection ---
// Canvas, Google Classroom, and Moodle frequently navigate between course
// pages via the History API without a full page reload, so a one-time
// detection at script injection is not enough. Patch pushState/replaceState
// and listen for popstate/hashchange so course context updates immediately
// whenever the URL changes.
const originalPushState = history.pushState.bind(history);
history.pushState = function (...args: Parameters<History['pushState']>) {
  originalPushState(...args);
  handlePossibleNavigation();
};

const originalReplaceState = history.replaceState.bind(history);
history.replaceState = function (...args: Parameters<History['replaceState']>) {
  originalReplaceState(...args);
  handlePossibleNavigation();
};

window.addEventListener('popstate', handlePossibleNavigation);
window.addEventListener('hashchange', handlePossibleNavigation);

// Cheap fallback for the rare case a platform updates the URL through
// neither the History API nor a hash change (e.g. via direct manipulation
// some SPA frameworks use). Low overhead, purely a safety net.
setInterval(handlePossibleNavigation, 2000);

// Find all PDF URLs on the current D2L page
function findPdfUrls(): string[] {
  const urls: string[] = [];
  const origin = window.location.origin;

  // D2L Download button — this is the most reliable way to get the actual PDF
  document.querySelectorAll('a[href*="Download"], a[download], button[data-download], a.d2l-button').forEach((el) => {
    const href = (el as HTMLAnchorElement).href;
    if (href && href.startsWith('http')) urls.push(href);
  });

  // D2L content file URLs in links
  document.querySelectorAll('a[href*="/content/enforced/"], a[href*="/content/"], a[href*=".pdf"]').forEach((a) => {
    const href = (a as HTMLAnchorElement).href;
    if (href) urls.push(href);
  });

  // Look for D2L's file download pattern in page HTML
  const pageHtml = document.documentElement.innerHTML;
  
  // Pattern: /d2l/le/content/COURSEID/topics/files/download/FILEID/DirectFileTopicDownload
  const downloadMatches = pageHtml.match(/\/d2l\/le\/content\/\d+\/topics\/files\/download\/[^"'\s<>]+/gi) || [];
  downloadMatches.forEach((path) => urls.push(origin + path));

  // Pattern: /content/enforced/COURSEID-NAME/filename.pdf
  const enforcedMatches = pageHtml.match(/\/content\/enforced\/[^"'\s<>]+\.pdf/gi) || [];
  enforcedMatches.forEach((path) => urls.push(origin + path));

  // Direct PDF links
  const directPdfMatches = pageHtml.match(/https?:\/\/[^"'\s<>]+\.pdf[^"'\s<>]*/gi) || [];
  directPdfMatches.forEach((url) => urls.push(url));

  // D2L viewContent URL (current page might be one)
  const currentUrl = window.location.href;
  if (currentUrl.includes('/viewContent/') || currentUrl.includes('/topics/')) {
    // Try to construct download URL from current page URL
    const topicMatch = currentUrl.match(/\/d2l\/le\/content\/(\d+)\/viewContent\/(\d+)/);
    if (topicMatch) {
      urls.push(`${origin}/d2l/le/content/${topicMatch[1]}/topics/files/download/${topicMatch[2]}/DirectFileTopicDownload`);
    }
  }

  return [...new Set(urls)];
}

// Get all text from page including iframes — auto-scrolls PDF viewer first
function getPageText(): Promise<string> {
  return new Promise((resolve) => {
    // Find all scrollable containers on the page and scroll them
    const scrollables: Element[] = [];
    
    // The D2L PDF viewer is typically in a div with overflow:auto/scroll
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      const isScrollable = (style.overflow === 'auto' || style.overflow === 'scroll' || 
                           style.overflowY === 'auto' || style.overflowY === 'scroll');
      if (isScrollable && el.scrollHeight > el.clientHeight + 100) {
        scrollables.push(el);
      }
    });

    // Also add the main document
    scrollables.push(document.documentElement);

    let containersProcessed = 0;

    function processNextContainer() {
      if (containersProcessed >= scrollables.length) {
        // All scrolled — now collect text
        setTimeout(() => {
          let text = document.body.innerText || '';
          try {
            document.querySelectorAll('iframe').forEach((iframe) => {
              try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc?.body) text += '\n\n' + doc.body.innerText;
              } catch {}
            });
          } catch {}
          resolve(text);
        }, 300);
        return;
      }

      const container = scrollables[containersProcessed];
      const totalHeight = container.scrollHeight;
      const originalTop = container.scrollTop;
      let pos = 0;

      function scrollStep() {
        if (pos < totalHeight) {
          container.scrollTop = pos;
          pos += 600;
          setTimeout(scrollStep, 30);
        } else {
          // Restore position
          container.scrollTop = originalTop;
          containersProcessed++;
          setTimeout(processNextContainer, 100);
        }
      }

      scrollStep();
    }

    processNextContainer();
  });
}

/** Builds the payload for GET_COURSE_INFO. Never throws. */
function buildCourseInfoPayload() {
  return detectedCourseId
    ? {
        courseId: detectedCourseId,
        courseName: detectedCourseName ?? 'Unknown Course',
        platform: activePlatformName ?? 'Unknown',
        pageUrl: window.location.href,
      }
    : null;
}

/**
 * Calls `sendResponse` exactly once, swallowing any error it throws (the
 * channel may already be closed if the requester navigated away or timed
 * out) so a failed response delivery can never surface as an uncaught
 * exception in this content script.
 */
function safeSendResponse(sendResponse: (response: unknown) => void, response: unknown): void {
  try {
    sendResponse(response);
  } catch {
    // The message port may already be closed — nothing further to do.
  }
}

/**
 * Routes a single incoming runtime message to its handler and returns the
 * response payload synchronously. Every case is self-contained and never
 * throws by construction (all underlying platform-adapter calls are
 * already defensive), but this function's own body is still covered by
 * the caller's try/finally as a last line of defense.
 */
function buildSyncResponse(messageType: string | undefined): unknown {
  switch (messageType) {
    case 'GET_COURSE_INFO':
      return { payload: buildCourseInfoPayload() };

    case 'GET_ACTIVE_PLATFORM':
      return { payload: { platformName: activePlatformName } };

    case 'GET_DOCUMENT_LINKS': {
      const links = activeAdapter ? activeAdapter.getDocumentLinks(document) : [];
      return { payload: { links } };
    }

    default:
      return { payload: null };
  }
}

// Listen for messages from service worker / side panel.
//
// IMPORTANT: the entire listener body runs inside a try/finally so
// `sendResponse()` is GUARANTEED to be invoked exactly once for every
// synchronous message type, even on an unexpected error — the `finally`
// block calls it unconditionally unless the async `GET_PAGE_TEXT` branch
// has already taken over responsibility for responding itself. If this
// listener were to throw without ever calling `sendResponse`, the
// caller's `chrome.runtime.sendMessage` promise would hang until Chrome
// eventually rejects it with "The message port closed before a response
// was received" — which is exactly the failure mode that previously left
// the side panel stuck showing the unsupported-page message.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const messageType: string | undefined = message?.type;
  let responseSent = false;

  try {
    if (messageType === 'GET_PAGE_TEXT') {
      // Async path: scroll page first, then collect text. This branch owns
      // sendResponse for the async result — the outer finally must NOT
      // fire an additional (empty) response for it, so we mark it sent
      // immediately and return `true` to keep the channel open.
      responseSent = true;
      getPageText()
        .then((text) => {
          safeSendResponse(sendResponse, { payload: { text, pdfUrls: findPdfUrls() } });
        })
        .catch(() => {
          safeSendResponse(sendResponse, { payload: { text: '', pdfUrls: [] } });
        });
      return true; // Keep channel open for the async response above.
    }

    const response = buildSyncResponse(messageType);
    safeSendResponse(sendResponse, response);
    responseSent = true;
  } catch {
    // Any unexpected synchronous error falls through to the `finally`
    // block below, which guarantees a response is still sent.
  } finally {
    if (!responseSent) {
      safeSendResponse(sendResponse, { payload: null });
    }
  }

  return false;
});

