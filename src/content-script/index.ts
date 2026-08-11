// ============================================================
// Content Script - Injected into LMS pages
// Listens for messages from the service worker and delegates
// to the active platform adapter for course info extraction.
// ============================================================

// TODO: Import and use AdapterRegistry when Task 3 (platform adapter) is complete
// import { adapterRegistry } from '@/platform';

// Detect platform on page load
let activePlatformName: string | null = null;
let detectedCourseId: string | null = null;
let detectedCourseName: string | null = null;

function detectPlatform() {
  const url = window.location.href;

  // Basic D2L Brightspace detection (will be replaced by adapter registry)
  if (url.includes('.brightspace.com') || url.includes('/d2l/')) {
    activePlatformName = 'D2L Brightspace';

    // Try to extract course ID from URL pattern: /d2l/home/{courseId} or /d2l/le/lessons/{courseId}
    const courseIdMatch = url.match(/\/d2l\/(?:home|le\/(?:lessons|content))\/(\d+)/);
    detectedCourseId = courseIdMatch ? courseIdMatch[1] : null;

    // Try to extract course name from page title or header
    const headerEl = document.querySelector('.d2l-page-title, .d2l-navigation-s-header-logo-area, [class*="course-name"]');
    detectedCourseName = headerEl?.textContent?.trim() ?? document.title.split(' - ')[0]?.trim() ?? null;
  }

  // Notify service worker of platform detection
  chrome.runtime.sendMessage({
    type: 'CONTENT_PLATFORM_DETECTED',
    payload: { platformName: activePlatformName },
  }).catch(() => { /* Side panel may not be open yet */ });
}

// Run detection on page load
detectPlatform();

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_COURSE_INFO':
      sendResponse({
        payload: detectedCourseId
          ? {
              courseId: detectedCourseId,
              courseName: detectedCourseName ?? 'Unknown Course',
              platform: activePlatformName ?? 'Unknown',
              pageUrl: window.location.href,
            }
          : null,
      });
      break;

    case 'GET_ACTIVE_PLATFORM':
      sendResponse({
        payload: { platformName: activePlatformName },
      });
      break;

    case 'GET_DOCUMENT_LINKS':
      // TODO: Wire to adapter's getDocumentLinks() when Task 3 is complete
      sendResponse({ payload: { links: [] } });
      break;

    default:
      sendResponse({ payload: null });
  }

  return false; // Synchronous response
});
