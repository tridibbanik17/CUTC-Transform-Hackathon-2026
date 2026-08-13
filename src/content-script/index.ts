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

// Load PDF.js — try to use D2L's existing instance first, then CDN fallback
async function loadPdfJsLibrary(): Promise<void> {
  return new Promise((resolve, reject) => {
    // First check if pdfjsLib already exists (D2L loads it for their viewer)
    const checkScript = document.createElement('script');
    checkScript.textContent = `
      (function() {
        if (window.pdfjsLib) {
          document.dispatchEvent(new Event('pdfjs-loaded'));
        } else {
          // Try loading from CDN
          var s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.js';
          s.onload = function() {
            if (window.pdfjsLib) {
              window.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
              document.dispatchEvent(new Event('pdfjs-loaded'));
            } else {
              document.dispatchEvent(new Event('pdfjs-failed'));
            }
          };
          s.onerror = function() {
            document.dispatchEvent(new Event('pdfjs-failed'));
          };
          document.head.appendChild(s);
        }
      })();
    `;
    document.head.appendChild(checkScript);
    checkScript.remove();

    const timeout = setTimeout(() => reject(new Error('PDF.js load timeout')), 15000);
    
    document.addEventListener('pdfjs-loaded', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    
    document.addEventListener('pdfjs-failed', () => {
      clearTimeout(timeout);
      reject(new Error('PDF.js failed to load'));
    }, { once: true });
  });
}

/**
 * Extract PDF text by injecting extraction code into the page context.
 * Returns text via a custom event.
 */
function extractPdfInPageContext(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve) => {
    const bytes = new Uint8Array(buffer);
    
    // Store the PDF data in a hidden element (avoids inline script size limits)
    const dataEl = document.createElement('input');
    dataEl.type = 'hidden';
    dataEl.id = '__coursechat_pdf_data';
    // Convert to base64 in chunks to avoid stack overflow
    let base64 = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      base64 += String.fromCharCode.apply(null, Array.from(chunk));
    }
    dataEl.value = btoa(base64);
    document.body.appendChild(dataEl);

    // Listen for result
    const timeout = setTimeout(() => {
      dataEl.remove();
      resolve('');
    }, 60000);

    document.addEventListener('pdfjs-extract-result', ((e: CustomEvent) => {
      clearTimeout(timeout);
      dataEl.remove();
      resolve(e.detail || '');
    }) as EventListener, { once: true });

    // Inject extraction script
    const script = document.createElement('script');
    script.textContent = `
      (async function() {
        try {
          var dataEl = document.getElementById('__coursechat_pdf_data');
          if (!dataEl) { document.dispatchEvent(new CustomEvent('pdfjs-extract-result', {detail: ''})); return; }
          var base64 = dataEl.value;
          var binary = atob(base64);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          
          var pdf = await window.pdfjsLib.getDocument({data: bytes, disableWorker: true}).promise;
          var allText = [];
          
          for (var p = 1; p <= pdf.numPages; p++) {
            var page = await pdf.getPage(p);
            var tc = await page.getTextContent();
            var pageText = '';
            var lastY = null;
            for (var j = 0; j < tc.items.length; j++) {
              var item = tc.items[j];
              if (!item.str) continue;
              var y = item.transform[5];
              if (lastY !== null && Math.abs(y - lastY) > 2) pageText += '\\n';
              pageText += item.str;
              lastY = y;
            }
            if (pageText.trim()) allText.push('[Page ' + p + ']\\n' + pageText.trim());
          }
          
          document.dispatchEvent(new CustomEvent('pdfjs-extract-result', {detail: allText.join('\\n\\n')}));
        } catch(e) {
          document.dispatchEvent(new CustomEvent('pdfjs-extract-result', {detail: 'ERROR:' + e.message}));
        }
      })();
    `;
    document.head.appendChild(script);
    script.remove();
  });
}

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
      // Async: try to download the PDF directly and extract with PDF.js
      (async () => {
        const pdfUrls = findPdfUrls();
        let extractedText = '';

        // Try to fetch PDF with page cookies and extract with PDF.js
        for (const url of pdfUrls.slice(0, 2)) {
          try {
            const resp = await fetch(url, { credentials: 'same-origin' });
            if (!resp.ok) continue;
            const contentType = resp.headers.get('content-type') || '';
            
            if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
              const buffer = await resp.arrayBuffer();
              
              // Load PDF.js into page context and extract text
              try {
                await loadPdfJsLibrary();
                extractedText = await extractPdfInPageContext(buffer);
              } catch {
                // PDF.js failed — try crude binary extraction as fallback
                const bytes = new Uint8Array(buffer);
                const decoder = new TextDecoder('latin1');
                const raw = decoder.decode(bytes);
                const matches = raw.match(/\(([^\\)]{2,})\)/g) || [];
                const texts: string[] = [];
                for (const m of matches) {
                  const inner = m.slice(1, -1);
                  if (inner.match(/[a-zA-Z]{2,}/) && inner.length >= 3 && inner.length < 500) {
                    texts.push(inner);
                  }
                }
                if (texts.length > 10) extractedText = texts.join(' ');
              }

              if (extractedText.length > 100) break;
            }
          } catch {
            // Skip
          }
        }

        // Fall back to page DOM text
        let pageText = document.body.innerText || '';
        try {
          document.querySelectorAll('iframe').forEach((iframe) => {
            try {
              const doc = iframe.contentDocument || iframe.contentWindow?.document;
              if (doc?.body) pageText += '\n\n' + doc.body.innerText;
            } catch {}
          });
        } catch {}

        // Use whichever is longer
        const finalText = extractedText.length > pageText.length ? extractedText : pageText;

        sendResponse({
          payload: {
            text: finalText,
            pdfUrls,
          },
        });
      })();
      return true; // Keep channel open for async response

    default:
      sendResponse({ payload: null });
  }

  return false;
});
