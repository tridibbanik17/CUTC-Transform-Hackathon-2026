// ============================================================
// Document Processor - Local Text Extraction
// Fetches documents from LMS and extracts text content.
// Supports: PDF (via PDF.js), PPTX (ZIP/XML parsing), HTML
// Extracted text is sent to Backboard.io for chunking/embedding.
// No local chunking — sends whole extracted text.
// ============================================================

import type { DocumentLink, ExtractedDocument, PageContent, DocumentProcessorAPI } from '@/types';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB limit

/**
 * Document Processor implementation.
 * Handles fetching and text extraction for supported file types.
 */
export class DocumentProcessorImpl implements DocumentProcessorAPI {
  /**
   * Fetch a document from its URL and extract text + structural metadata.
   */
  async fetchAndExtract(link: DocumentLink): Promise<ExtractedDocument> {
    const response = await fetch(link.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch document ${link.fileName}: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE_BYTES) {
      throw new Error(`Document ${link.fileName} exceeds 50MB size limit (${Math.round(parseInt(contentLength) / 1024 / 1024)}MB)`);
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new Error(`Document ${link.fileName} exceeds 50MB size limit (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB)`);
    }

    switch (link.fileType) {
      case 'pdf':
        return this.extractPdf(arrayBuffer, link.fileName);
      case 'pptx':
        return this.extractPptx(arrayBuffer, link.fileName);
      case 'html':
        return this.extractHtml(arrayBuffer, link.fileName);
      default:
        throw new Error(`Unsupported file type: ${link.fileType}`);
    }
  }

  /**
   * Compute SHA-256 hash of document content for deduplication.
   */
  async computeDocumentHash(link: DocumentLink): Promise<string> {
    const response = await fetch(link.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch document for hashing: ${link.fileName}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // --- PDF Extraction (via PDF.js) ---

  private async extractPdf(buffer: ArrayBuffer, fileName: string): Promise<ExtractedDocument> {
    const data = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;

    const pages: PageContent[] = [];
    let totalCharacters = 0;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      let pageText = '';
      const headings: string[] = [];
      let lastY: number | null = null;
      let currentLine = '';

      for (const item of textContent.items) {
        if (!('str' in item)) continue;
        const textItem = item as { str: string; transform: number[]; height: number };

        // Detect line breaks by Y position change
        const y = textItem.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          if (currentLine.trim()) {
            pageText += currentLine.trim() + '\n';
            // Heuristic: larger font items at start of lines are likely headings
            if (textItem.height > 14 && currentLine.trim().length < 100) {
              headings.push(currentLine.trim());
            }
          }
          currentLine = '';
        }
        currentLine += textItem.str;
        lastY = y;
      }

      // Add final line
      if (currentLine.trim()) {
        pageText += currentLine.trim() + '\n';
      }

      const trimmedText = pageText.trim();
      if (trimmedText.length > 0) {
        pages.push({
          pageNumber: i,
          headings,
          text: trimmedText,
        });
        totalCharacters += trimmedText.length;
      }
    }

    return { fileName, fileType: 'pdf', pages, totalCharacters };
  }

  // --- PPTX Extraction (ZIP/XML parsing) ---

  private async extractPptx(buffer: ArrayBuffer, fileName: string): Promise<ExtractedDocument> {
    // PPTX files are ZIP archives containing XML slides
    // We use the browser's built-in capabilities to parse them

    const pages: PageContent[] = [];
    let totalCharacters = 0;

    try {
      const blob = new Blob([buffer], { type: 'application/zip' });
      // Use a minimal ZIP reader approach
      const slides = await this.parsePptxSlides(buffer);

      for (let i = 0; i < slides.length; i++) {
        const slideText = slides[i].trim();
        if (slideText.length > 0) {
          // First line of a slide is typically the title/heading
          const lines = slideText.split('\n');
          const headings = lines.length > 0 && lines[0].length < 100 ? [lines[0]] : [];

          pages.push({
            pageNumber: i + 1,
            headings,
            text: slideText,
          });
          totalCharacters += slideText.length;
        }
      }
    } catch (err) {
      throw new Error(`Failed to extract PPTX content from ${fileName}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    return { fileName, fileType: 'pptx', pages, totalCharacters };
  }

  /**
   * Parse PPTX ZIP archive and extract text from each slide XML.
   * PPTX structure: ppt/slides/slide1.xml, slide2.xml, etc.
   */
  private async parsePptxSlides(buffer: ArrayBuffer): Promise<string[]> {
    const slides: string[] = [];
    const uint8 = new Uint8Array(buffer);

    // Find ZIP local file headers and extract slide XMLs
    const files = this.parseZipEntries(uint8);

    // Sort slide files by number
    const slideFiles = files
      .filter((f) => f.name.match(/^ppt\/slides\/slide\d+\.xml$/))
      .sort((a, b) => {
        const numA = parseInt(a.name.match(/slide(\d+)/)?.[1] ?? '0');
        const numB = parseInt(b.name.match(/slide(\d+)/)?.[1] ?? '0');
        return numA - numB;
      });

    for (const slideFile of slideFiles) {
      const xmlText = new TextDecoder().decode(slideFile.data);
      const textContent = this.extractTextFromSlideXml(xmlText);
      slides.push(textContent);
    }

    return slides;
  }

  /**
   * Minimal ZIP parser — extracts file entries from a ZIP buffer.
   */
  private parseZipEntries(data: Uint8Array): Array<{ name: string; data: Uint8Array }> {
    const entries: Array<{ name: string; data: Uint8Array }> = [];
    let offset = 0;

    while (offset < data.length - 4) {
      // Look for local file header signature: PK\x03\x04
      if (data[offset] === 0x50 && data[offset + 1] === 0x4b &&
          data[offset + 2] === 0x03 && data[offset + 3] === 0x04) {

        const compressionMethod = data[offset + 8] | (data[offset + 9] << 8);
        const compressedSize = data[offset + 18] | (data[offset + 19] << 8) |
                              (data[offset + 20] << 16) | (data[offset + 21] << 24);
        const uncompressedSize = data[offset + 22] | (data[offset + 23] << 8) |
                                (data[offset + 24] << 16) | (data[offset + 25] << 24);
        const fileNameLength = data[offset + 26] | (data[offset + 27] << 8);
        const extraFieldLength = data[offset + 28] | (data[offset + 29] << 8);

        const fileName = new TextDecoder().decode(
          data.slice(offset + 30, offset + 30 + fileNameLength)
        );

        const dataStart = offset + 30 + fileNameLength + extraFieldLength;
        const dataSize = compressionMethod === 0 ? uncompressedSize : compressedSize;

        // Only handle stored (uncompressed) files for simplicity
        // Most PPTX slide XMLs are stored uncompressed or we skip compressed ones
        if (compressionMethod === 0 && dataSize > 0) {
          entries.push({
            name: fileName,
            data: data.slice(dataStart, dataStart + dataSize),
          });
        }

        offset = dataStart + dataSize;
      } else {
        offset++;
      }
    }

    return entries;
  }

  /**
   * Extract text content from a PPTX slide XML string.
   * Looks for <a:t> tags which contain the actual text.
   */
  private extractTextFromSlideXml(xml: string): string {
    const textParts: string[] = [];

    // Match all <a:t>...</a:t> text elements
    const regex = /<a:t[^>]*>(.*?)<\/a:t>/gs;
    let match;
    let lastParagraphEnd = 0;

    // Also detect paragraph boundaries <a:p>
    const paragraphRegex = /<\/a:p>/g;
    const paragraphPositions: number[] = [];
    let pMatch;
    while ((pMatch = paragraphRegex.exec(xml)) !== null) {
      paragraphPositions.push(pMatch.index);
    }

    while ((match = regex.exec(xml)) !== null) {
      const text = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");

      // Check if we crossed a paragraph boundary
      const currentPos = match.index;
      const crossedParagraph = paragraphPositions.some(
        (p) => p > lastParagraphEnd && p < currentPos
      );

      if (crossedParagraph && textParts.length > 0) {
        textParts.push('\n');
      }

      textParts.push(text);
      lastParagraphEnd = currentPos;
    }

    return textParts.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  // --- HTML Extraction ---

  private async extractHtml(buffer: ArrayBuffer, fileName: string): Promise<ExtractedDocument> {
    const html = new TextDecoder().decode(buffer);

    // Parse HTML and extract text content
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove script and style elements
    doc.querySelectorAll('script, style, nav, footer, header').forEach((el) => el.remove());

    const pages: PageContent[] = [];
    const headings: string[] = [];

    // Extract headings
    doc.querySelectorAll('h1, h2, h3').forEach((el) => {
      const text = el.textContent?.trim();
      if (text) headings.push(text);
    });

    // Get body text
    const bodyText = doc.body?.textContent?.trim() ?? '';

    if (bodyText.length > 0) {
      pages.push({
        pageNumber: 1,
        headings,
        text: bodyText,
      });
    }

    return {
      fileName,
      fileType: 'html',
      pages,
      totalCharacters: bodyText.length,
    };
  }
}

/** Singleton instance */
export const documentProcessor = new DocumentProcessorImpl();
