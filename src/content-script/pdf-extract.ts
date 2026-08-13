// ============================================================
// PDF Text Extraction for Content Script
// Uses PDF.js loaded as a web accessible resource to extract
// all text from a PDF ArrayBuffer.
// ============================================================

/**
 * Extract text from a PDF ArrayBuffer using PDF.js.
 * PDF.js is loaded from the extension's bundled resources.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  // Load PDF.js from CDN (content script can access this)
  // We use the global pdfjsLib if available, otherwise load it
  const pdfjsLib = await loadPdfJs();
  
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    let pageText = '';
    let lastY: number | null = null;

    for (const item of textContent.items) {
      if (!('str' in item)) continue;
      const textItem = item as { str: string; transform: number[] };
      
      const y = textItem.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        pageText += '\n';
      }
      pageText += textItem.str;
      lastY = y;
    }

    if (pageText.trim()) {
      pages.push(`[Page ${i}]\n${pageText.trim()}`);
    }
  }

  return pages.join('\n\n');
}

/**
 * Load PDF.js library dynamically.
 */
async function loadPdfJs(): Promise<any> {
  // Check if already loaded
  if ((window as any).pdfjsLib) {
    return (window as any).pdfjsLib;
  }

  // Load from CDN
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs';
    script.type = 'module';
    
    // For module scripts, we need a different approach
    // Use the classic build instead
    const classicScript = document.createElement('script');
    classicScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.js';
    classicScript.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (lib) {
        lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js';
        resolve(lib);
      } else {
        reject(new Error('PDF.js failed to load'));
      }
    };
    classicScript.onerror = () => reject(new Error('Failed to load PDF.js script'));
    document.head.appendChild(classicScript);
  });
}
