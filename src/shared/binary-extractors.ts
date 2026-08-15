// ============================================================
// Binary File Extractors
// Pure functions for extracting text from binary document formats.
// Used by the side panel upload handler for PPTX, DOCX, DOC, ODT.
// No external dependencies — operates directly on ArrayBuffer/Uint8Array.
// ============================================================

/**
 * Extract text from a PPTX file (ArrayBuffer).
 * PPTX files are ZIP archives with slide XMLs at ppt/slides/slideN.xml.
 */
export async function extractPptxText(buffer: ArrayBuffer): Promise<string> {
  const uint8 = new Uint8Array(buffer);
  const files = parseZipEntries(uint8);

  const slideFiles = files
    .filter((f) => f.name.match(/^ppt\/slides\/slide\d+\.xml$/))
    .sort((a, b) => {
      const numA = parseInt(a.name.match(/slide(\d+)/)?.[1] ?? '0');
      const numB = parseInt(b.name.match(/slide(\d+)/)?.[1] ?? '0');
      return numA - numB;
    });

  const slideTexts: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const decompressed = await decompressEntry(slideFiles[i]);
    const xml = new TextDecoder().decode(decompressed);
    const text = extractTextFromSlideXml(xml);
    if (text.trim()) {
      slideTexts.push(`[Slide ${i + 1}]\n${text.trim()}`);
    }
  }

  return slideTexts.join('\n\n');
}

/**
 * Extract text from a DOCX file (ArrayBuffer).
 * DOCX files are ZIP archives with content at word/document.xml.
 */
export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const uint8 = new Uint8Array(buffer);
  const files = parseZipEntries(uint8);

  const documentFile = files.find((f) => f.name === 'word/document.xml');
  if (!documentFile) return '';

  const decompressed = await decompressEntry(documentFile);
  const xml = new TextDecoder().decode(decompressed);
  return extractTextFromDocxXml(xml);
}

/**
 * Extract text from a legacy .doc file (ArrayBuffer).
 * Best-effort binary scan for readable text sequences.
 */
export function extractDocText(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);
  const textChunks: string[] = [];
  let currentChunk = '';

  for (let i = 0; i < uint8.length; i++) {
    const byte = uint8[i];
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

  // Filter noise — keep chunks that look like actual text
  const filtered = textChunks.filter((chunk) => {
    const words = chunk.split(/\s+/);
    return words.length >= 2 && chunk.length >= 10;
  });

  return filtered.join('\n').trim();
}

/**
 * Extract text from an ODT file (ArrayBuffer).
 * ODT files are ZIP archives with content at content.xml.
 */
export async function extractOdtText(buffer: ArrayBuffer): Promise<string> {
  const uint8 = new Uint8Array(buffer);
  const files = parseZipEntries(uint8);

  const contentFile = files.find((f) => f.name === 'content.xml');
  if (!contentFile) return '';

  const decompressed = await decompressEntry(contentFile);
  const xml = new TextDecoder().decode(decompressed);
  return extractTextFromOdtXml(xml);
}

// ============================================================
// Internal helpers
// ============================================================

interface ZipEntry {
  name: string;
  data: Uint8Array;
  compressed: boolean;
}

/**
 * Decompress DEFLATE-compressed data using the browser's DecompressionStream API.
 * Falls back to returning raw data if decompression fails.
 */
async function decompressEntry(entry: ZipEntry): Promise<Uint8Array> {
  if (!entry.compressed) return entry.data;

  try {
    // DecompressionStream expects 'deflate-raw' for raw DEFLATE (no zlib header)
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    writer.write(entry.data);
    writer.close();

    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } catch {
    // If decompression fails, return empty
    return new Uint8Array(0);
  }
}

/**
 * Minimal ZIP parser — extracts file entries, handling both stored and DEFLATE-compressed.
 */
function parseZipEntries(data: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset < data.length - 4) {
    // Local file header signature: PK\x03\x04
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
      const dataSize = compressedSize > 0 ? compressedSize : uncompressedSize;

      if (dataSize > 0) {
        const rawData = data.slice(dataStart, dataStart + dataSize);
        entries.push({
          name: fileName,
          data: rawData,
          compressed: compressionMethod === 8,
        });
      }

      offset = dataStart + dataSize;
    } else {
      offset++;
    }
  }

  return entries;
}

/** Extract text from PPTX slide XML — looks for <a:t> text elements. */
function extractTextFromSlideXml(xml: string): string {
  const textParts: string[] = [];
  const regex = /<a:t[^>]*>(.*?)<\/a:t>/gs;
  let match;
  let lastParagraphEnd = 0;

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

/** Extract text from DOCX word/document.xml — looks for <w:t> text runs. */
function extractTextFromDocxXml(xml: string): string {
  const paragraphs: string[] = [];
  const paragraphRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let pMatch;

  while ((pMatch = paragraphRegex.exec(xml)) !== null) {
    const pXml = pMatch[0];
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

    if (paragraphText.trim().length > 0) {
      paragraphs.push(paragraphText);
    }
  }

  return paragraphs.join('\n').trim();
}

/** Extract text from ODT content.xml — looks for <text:p> and <text:h> elements. */
function extractTextFromOdtXml(xml: string): string {
  const paragraphs: string[] = [];

  // Extract headings <text:h>
  const headingRegex = /<text:h[^>]*>([\s\S]*?)<\/text:h>/g;
  let hMatch;
  while ((hMatch = headingRegex.exec(xml)) !== null) {
    const text = hMatch[1].replace(/<[^>]+>/g, '').trim();
    if (text) paragraphs.push(text);
  }

  // Extract paragraphs <text:p>
  const pRegex = /<text:p[^>]*>([\s\S]*?)<\/text:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const text = pMatch[1].replace(/<[^>]+>/g, '').trim();
    if (text) paragraphs.push(text);
  }

  return paragraphs.join('\n').trim();
}
