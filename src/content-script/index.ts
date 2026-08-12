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
