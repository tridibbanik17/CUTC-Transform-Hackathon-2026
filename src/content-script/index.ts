// ============================================================
// Content Script - Injected into all pages
// Detects LMS platform, extracts course info, and provides
// page text + PDF URLs for indexing.
// ============================================================

// Detect platform on page load
let activePlatformName: string | null = null;
let detectedCourseId: string | null = null;
let detectedCourseName: string | null = null;

function detectPlatform() {
  const url = window.location.href;

  if (url.includes('.brightspace.com') || url.includes('/d2l/')) {
    activePlatformName = 'D2L Brightspace';

    const courseIdMatch = url.match(/\/d2l\/(?:home|le\/(?:lessons|content))\/(\d+)/);
    detectedCourseId = courseIdMatch ? courseIdMatch[1] : null;

    const headerEl = document.querySelector('.d2l-page-title, .d2l-navigation-s-header-logo-area, [class*="course-name"]');
    detectedCourseName = headerEl?.textContent?.trim() ?? document.title.split(' - ')[0]?.trim() ?? null;
  }

  chrome.runtime.sendMessage({
    type: 'CONTENT_PLATFORM_DETECTED',
    payload: { platformName: activePlatformName },
  }).catch(() => {});
}

detectPlatform();

// Find all PDF URLs on the current D2L page
function findPdfUrls(): string[] {
  const urls: string[] = [];
  const pageHtml = document.documentElement.innerHTML;
  const origin = window.location.origin;

  // D2L content file URLs: /content/enforced/COURSEID/filename.pdf
  const contentMatches = pageHtml.match(/\/content\/enforced\/[^"'\s<>]+\.pdf/gi) || [];
  contentMatches.forEach((path) => urls.push(origin + path));

  // D2L viewContent URLs
  const viewContentMatches = pageHtml.match(/\/d2l\/le\/content\/\d+\/viewContent\/\d+\/View/gi) || [];
  viewContentMatches.forEach((path) => urls.push(origin + path));

  // Direct PDF links anywhere
  const directPdfMatches = pageHtml.match(/https?:\/\/[^"'\s<>]+\.pdf/gi) || [];
  directPdfMatches.forEach((url) => urls.push(url));

  // Object/embed sources
  document.querySelectorAll('object[data], embed[src]').forEach((el) => {
    const src = (el as HTMLObjectElement).data || (el as HTMLEmbedElement).src;
    if (src && (src.includes('.pdf') || src.includes('/content/'))) {
      urls.push(src.startsWith('http') ? src : origin + src);
    }
  });

  // Iframe sources that might be PDF viewers
  document.querySelectorAll('iframe[src]').forEach((iframe) => {
    const src = (iframe as HTMLIFrameElement).src;
    if (src && (src.includes('.pdf') || src.includes('/content/') || src.includes('viewContent'))) {
      urls.push(src);
    }
  });

  return [...new Set(urls)];
}

// Get all text from page including iframes
function getPageText(): string {
  let text = document.body.innerText || '';

  // Try same-origin iframes
  try {
    document.querySelectorAll('iframe').forEach((iframe) => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc?.body) text += '\n\n' + doc.body.innerText;
      } catch {}
    });
  } catch {}

  return text;
}

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
      sendResponse({ payload: { platformName: activePlatformName } });
      break;

    case 'GET_DOCUMENT_LINKS':
      sendResponse({ payload: { links: [] } });
      break;

    case 'GET_PAGE_TEXT':
      sendResponse({
        payload: {
          text: getPageText(),
          pdfUrls: findPdfUrls(),
        },
      });
      break;

    default:
      sendResponse({ payload: null });
  }

  return false;
});
