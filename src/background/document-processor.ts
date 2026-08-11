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
      case 'ipynb':
        return this.extractIpynb(arrayBuffer, link.fileName);
      case 'docx':
        return this.extractDocx(arrayBuffer, link.fileName);
      case 'doc':
        return this.extractDoc(arrayBuffer, link.fileName);
      case 'odt':
        return this.extractOdt(arrayBuffer, link.fileName);
      case 'txt':
      case 'md':
      case 'py':
      case 'java':
      case 'js':
      case 'cpp':
      case 'css':
      case 'csv':
        return this.extractPlainText(arrayBuffer, link.fileName, link.fileType);
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

  // --- Plain Text / Code File Extraction ---

  private async extractPlainText(
    buffer: ArrayBuffer,
    fileName: string,
    fileType: string
  ): Promise<ExtractedDocument> {
    const text = new TextDecoder().decode(buffer).trim();

    if (text.length === 0) {
      return { fileName, fileType, pages: [], totalCharacters: 0 };
    }

    const headings: string[] = [];

    // Heuristic: first non-empty line that looks like a title/comment
    const firstLine = text.split('\n')[0]?.trim() ?? '';
    if (firstLine.startsWith('#') || firstLine.startsWith('//') || firstLine.startsWith('/*')) {
      headings.push(firstLine.replace(/^[#/\*\s]+/, '').trim());
    }

    return {
      fileName,
      fileType,
      pages: [{
        pageNumber: 1,
        headings,
        text,
      }],
      totalCharacters: text.length,
    };
  }

  // --- Jupyter Notebook (.ipynb) Extraction ---

  private async extractIpynb(buffer: ArrayBuffer, fileName: string): Promise<ExtractedDocument> {
    const jsonText = new TextDecoder().decode(buffer);
    let notebook: {
      cells?: Array<{
        cell_type: string;
        source: string | string[];
      }>;
    };

    try {
      notebook = JSON.parse(jsonText);
    } catch {
      throw new Error(`Failed to parse Jupyter notebook ${fileName}: invalid JSON`);
    }

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return { fileName, fileType: 'ipynb', pages: [], totalCharacters: 0 };
    }

    const pages: PageContent[] = [];
    let totalCharacters = 0;
    let cellNumber = 0;

    for (const cell of notebook.cells) {
      cellNumber++;

      // Get cell source (can be string or array of strings)
      const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
      const trimmed = source.trim();

      if (trimmed.length === 0) continue;

      const headings: string[] = [];

      if (cell.cell_type === 'markdown') {
        // Extract markdown headings
        const lines = trimmed.split('\n');
        for (const line of lines) {
          if (line.startsWith('#')) {
            headings.push(line.replace(/^#+\s*/, '').trim());
          }
        }
      }

      // Prefix code cells to make it clear in retrieval
      const cellText = cell.cell_type === 'code'
        ? `[Code Cell ${cellNumber}]\n${trimmed}`
        : trimmed;

      pages.push({
        pageNumber: cellNumber,
        headings,
        text: cellText,
      });
      totalCharacters += cellText.length;
    }

    return { fileName, fileType: 'ipynb', pages, totalCharacters };
  }

  // --- DOCX Extraction (ZIP/XML parsing) ---

  private async extractDocx(buffer: ArrayBuffer, fileName: string): Promise<ExtractedDocument> {
    const uint8 = new Uint8Array(buffer);
    const files = this.parseZipEntries(uint8);

    // Find word/document.xml — the main content file
    const documentFile = files.find((f) => f.name === 'word/document.xml');
    if (!documentFile) {
      throw new Error(`Failed to extract DOCX content from ${fileName}: word/document.xml not found`);
    }

    const xml = new TextDecoder().decode(documentFile.data);
    const { text, headings } = this.extractTextFromDocxXml(xml);

    if (text.length === 0) {
      return { fileName, fileType: 'docx', pages: [], totalCharacters: 0 };
    }

    return {
      fileName,
      fileType: 'docx',
      pages: [{
        pageNumber: 1,
        headings,
        text,
      }],
      totalCharacters: text.length,
    };
  }

  /**
   * Extract text from DOCX word/document.xml.
   * Looks for <w:t> tags (text runs) and <w:p> (paragraphs).
   * Detects headings via <w:pStyle w:val="Heading1"/> etc.
   */
  private extractTextFromDocxXml(xml: string): { text: string; headings: string[] } {
    const headings: string[] = [];
    const paragraphs: string[] = [];

    // Split by paragraph elements <w:p>...</w:p>
    const paragraphRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    let pMatch;

    while ((pMatch = paragraphRegex.exec(xml)) !== null) {
      const pXml = pMatch[0];

      // Extract all text runs <w:t>...</w:t>
      const textRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let tMatch;
      let paragraphText = '';

      while ((tMatch = textRegex.exec(pXml)) !== null) {
        paragraphText += tMatch[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
      }

      if (paragraphText.trim().length === 0) continue;

      // Check if this paragraph has a heading style
      const styleMatch = pXml.match(/<w:pStyle\s+w:val="([^"]*)"\/>/);
      if (styleMatch && /heading/i.test(styleMatch[1])) {
        headings.push(paragraphText.trim());
      }

      paragraphs.push(paragraphText);
    }

    return { text: paragraphs.join('\n').trim(), headings };
  }

  // --- DOC Extraction (legacy binary format — best effort) ---

  private async extractDoc(buffer: ArrayBuffer, fileName: string): Promise<ExtractedDocument> {
    // Legacy .doc is a binary OLE2 format. Full parsing requires a complex library.
    // Best-effort approach: scan for readable ASCII/UTF-16 text sequences.
    const uint8 = new Uint8Array(buffer);
    const text = this.extractTextFromBinaryDoc(uint8);

    if (text.length === 0) {
      return { fileName, fileType: 'doc', pages: [], totalCharacters: 0 };
    }

    return {
      fileName,
      fileType: 'doc',
      pages: [{
        pageNumber: 1,
        headings: [],
        text,
      }],
      totalCharacters: text.length,
    };
  }

  /**
   * Best-effort text extraction from binary .doc files.
   * Scans for contiguous printable ASCII sequences (minimum length 4).
   * Won't capture formatting or structure but gets raw text content.
   */
  private extractTextFromBinaryDoc(data: Uint8Array): string {
    const textChunks: string[] = [];
    let currentChunk = '';

    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      // Printable ASCII range + common whitespace
      if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9) {
        currentChunk += String.fromCharCode(byte);
      } else {
        if (currentChunk.trim().length >= 4) {
          textChunks.push(currentChunk.trim());
        }
        currentChunk = '';
      }
    }

    if (currentChunk.trim().length >= 4) {
      textChunks.push(currentChunk.trim());
    }

    // Filter out binary noise — keep only chunks that look like real text
    const filtered = textChunks.filter((chunk) => {
      const words = chunk.split(/\s+/);
      return words.length >= 2 && chunk.length >= 10;
    });

    return filtered.join('\n').trim();
  }

  // --- ODT Extraction (ZIP/XML parsing, similar to DOCX) ---

  private async extractOdt(buffer: ArrayBuffer, fileName: string): Promise<ExtractedDocument> {
    const uint8 = new Uint8Array(buffer);
    const files = this.parseZipEntries(uint8);

    // Find content.xml — the main content file in ODT
    const contentFile = files.find((f) => f.name === 'content.xml');
    if (!contentFile) {
      throw new Error(`Failed to extract ODT content from ${fileName}: content.xml not found`);
    }

    const xml = new TextDecoder().decode(contentFile.data);
    const { text, headings } = this.extractTextFromOdtXml(xml);

    if (text.length === 0) {
      return { fileName, fileType: 'odt', pages: [], totalCharacters: 0 };
    }

    return {
      fileName,
      fileType: 'odt',
      pages: [{
        pageNumber: 1,
        headings,
        text,
      }],
      totalCharacters: text.length,
    };
  }

  /**
   * Extract text from ODT content.xml.
   * Looks for <text:p> paragraphs and <text:h> headings.
   */
  private extractTextFromOdtXml(xml: string): { text: string; headings: string[] } {
    const headings: string[] = [];
    const paragraphs: string[] = [];

    // Extract headings <text:h ...>...</text:h>
    const headingRegex = /<text:h[^>]*>([\s\S]*?)<\/text:h>/g;
    let hMatch;
    while ((hMatch = headingRegex.exec(xml)) !== null) {
      const headingText = hMatch[1].replace(/<[^>]+>/g, '').trim();
      if (headingText) {
        headings.push(headingText);
        paragraphs.push(headingText);
      }
    }

    // Extract paragraphs <text:p ...>...</text:p>
    const paragraphRegex = /<text:p[^>]*>([\s\S]*?)<\/text:p>/g;
    let pMatch;
    while ((pMatch = paragraphRegex.exec(xml)) !== null) {
      const pText = pMatch[1].replace(/<[^>]+>/g, '').trim();
      if (pText) {
        paragraphs.push(pText);
      }
    }

    return {
      text: paragraphs.join('\n').trim(),
      headings,
    };
  }
}

/** Singleton instance */
export const documentProcessor = new DocumentProcessorImpl();
