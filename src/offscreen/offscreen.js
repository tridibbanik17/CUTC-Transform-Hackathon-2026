// Offscreen document for PDF.js text extraction
// This runs in a full DOM context where PDF.js can operate properly

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PARSE_PDF') {
    parsePdf(message.data).then(sendResponse);
    return true; // async
  }
});

async function parsePdf(base64Data) {
  try {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      let pageText = '';
      let lastY = null;

      for (const item of textContent.items) {
        if (!item.str) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          pageText += '\n';
        }
        pageText += item.str;
        lastY = y;
      }

      if (pageText.trim()) {
        pages.push('[Page ' + i + ']\n' + pageText.trim());
      }
    }

    return { success: true, text: pages.join('\n\n') };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
