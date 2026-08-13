// ============================================================
// Google Classroom Platform Adapter
// ------------------------------------------------------------
// Implements the PlatformAdapter contract for Google Classroom,
// identified by the `classroom.google.com/c/<courseId>` and
// `/w/<courseId>` URL conventions, with an optional multi-account
// `/u/<index>/` prefix (e.g. `/u/0/`, `/u/1/`) and any trailing
// course tab (`/cw/all`, `/a/details`, `/p/...` for people, etc.).
//
// Every public method is defensive by design: URL/DOM parsing
// failures are caught locally so a single malformed page can
// never throw out of this adapter and break platform detection,
// course extraction, or the content-script message bridge that
// depends on it.
//
// Scope: URL matching, course metadata extraction, and document
// link discovery only. No local chunking or vector storage is
// performed here — extracted links/text are handed off upstream
// to the document processor and, ultimately, Backboard.io.
// ============================================================

import type { PlatformAdapter, DocumentLink, CitationMetadata } from '@/types';

/**
 * Google Classroom course convention: https://classroom.google.com/c/<courseId>/...
 * or the `/w/<courseId>` workspace variant, with an optional `/u/<index>/`
 * multi-account prefix (e.g. `/u/0/c/<id>`) and any trailing tab/sub-path.
 */
const CLASSROOM_COURSE_PATTERN = /^https:\/\/classroom\.google\.com\/(?:u\/\d+\/)?(?:c|w)\/([^/?#]+)/;

/** File extensions recognized as course materials, mapped to `DocumentLink['fileType']`. */
const SUPPORTED_EXTENSIONS: Record<string, DocumentLink['fileType']> = {
  pdf: 'pdf',
  pptx: 'pptx',
  html: 'html',
  htm: 'html',
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpeg',
  txt: 'txt',
  md: 'md',
  py: 'py',
  java: 'java',
  js: 'js',
  cpp: 'cpp',
  c: 'c',
  css: 'css',
  csv: 'csv',
  ipynb: 'ipynb',
  docx: 'docx',
  doc: 'doc',
  odt: 'odt',
  m: 'm',
};

/**
 * Maps a Google Drive/Docs mime-type indicator (found in `href` or nearby text)
 * to a `DocumentLink['fileType']`. Native Google Docs/Slides/Sheets do not have
 * a file extension in their URL, so we infer type from the drive host path and
 * export-friendly extension where possible. Never throws.
 */
function inferGoogleDriveFileType(href: string): DocumentLink['fileType'] | null {
  try {
    if (/\/presentation\//.test(href)) return 'pptx';
    if (/\/document\//.test(href)) return 'docx';
    return null;
  } catch {
    return null;
  }
}

/** Extracts the lower-cased file extension (without the dot) from a URL, ignoring query/hash. */
function getExtensionFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    const withoutQuery = url.split(/[?#]/)[0];
    const match = withoutQuery.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : null;
  }
}

/** Extracts an extension from free text (e.g. attachment title like "Reading.pdf"). */
function getExtensionFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/\.([a-z0-9]+)\s*$/i);
  return match ? match[1].toLowerCase() : null;
}

/** Derives a human-readable file/attachment name from a URL, falling back to anchor text. */
function getFileNameFromUrl(url: string, fallback?: string | null): string {
  const trimmedFallback = fallback?.trim();
  if (trimmedFallback && trimmedFallback.length > 0) return trimmedFallback;

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return decodeURIComponent(last);
  } catch {
    // ignore
  }
  return url;
}

/** Safely reads the current document's URL without ever throwing. */
function safeDocumentUrl(document: Document): string {
  try {
    return document.location?.href ?? document.URL ?? '';
  } catch {
    return '';
  }
}

export const googleClassroomAdapter: PlatformAdapter = {
  name: 'Google Classroom',

  urlPatterns: [CLASSROOM_COURSE_PATTERN],

  priority: 4,

  /** Detect Google Classroom course URLs via the `/c/` or `/w/` convention, with or without a `/u/<index>/` prefix. */
  matchesUrl(url: string): boolean {
    try {
      return this.urlPatterns.some((pattern) => pattern.test(url));
    } catch {
      return false;
    }
  },

  /**
   * A URL matching `classroom.google.com/c/<courseId>` (or `/w/<courseId>`,
   * with an optional `/u/<index>/` prefix) is itself a course page — the
   * Classroom "home" landing page (`/h`, without `/c/`or `/w/`) does not
   * match this pattern. Never throws — any URL access failure resolves
   * to `false`.
   */
  isCoursePage(document: Document): boolean {
    try {
      const url = safeDocumentUrl(document);
      if (!url) return false;
      return CLASSROOM_COURSE_PATTERN.test(url);
    } catch {
      return false;
    }
  },

  /**
   * Parse the Google Classroom course identifier out of the `/c/` or
   * `/w/` URL segment, regardless of any `/u/<index>/` multi-account
   * prefix. Never throws — returns `null` on any parsing failure.
   */
  extractCourseId(url: string): string | null {
    try {
      const match = url?.match(CLASSROOM_COURSE_PATTERN);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Extract the course name from the page header DOM.
   *
   * Defensive by design: Google Classroom's header markup is unstable
   * (obfuscated, framework-generated class names like `.YVvGBb`/`.aXCTVb`
   * change across releases and A/B tests), so `querySelector` may match
   * nothing, or match an element whose `textContent` is empty/whitespace.
   * Tries several selectors (header title attribute, known class names,
   * and generic `h1` fallbacks), then falls back to `document.title`,
   * and finally a generic string. Every DOM/string operation is
   * individually try/caught so a missing element, a detached node, or a
   * synchronous DOM exception can never throw out of this method — it
   * always resolves to a header title, a `document.title` fallback, or
   * a generic string, never `null`-pointer-crashing the caller (content
   * script / side panel).
   */
  extractCourseName(document: Document): string | null {
    const selectors = ['[data-header-title]', '.YVvGBb', '.aXCTVb', 'h1[class*="title"]', 'header h1', 'h1'];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        const text = el?.textContent?.trim();
        if (text) return text;
      } catch {
        continue;
      }
    }

    try {
      const rawTitle = document?.title ?? '';
      const titleText = rawTitle.split(' - ')[0]?.trim();
      if (titleText && titleText.length > 0) return titleText;
    } catch {
      // document.title access failed — fall through to the generic fallback below.
    }

    return 'Unknown Course';
  },

  /**
   * Enumerate attached Drive/document links from the page DOM, restricted
   * to supported file types. Every DOM query and per-element extraction
   * step is wrapped in try/catch so a non-standard node (missing `href`,
   * detached element, unexpected attribute shape) can never crash the
   * scan — it is simply skipped and extraction continues with the rest
   * of the page.
   */
  getDocumentLinks(document: Document): DocumentLink[] {
    const links = new Map<string, DocumentLink>();

    const addCandidate = (rawUrl: string, anchorText?: string | null) => {
      try {
        if (!rawUrl || !rawUrl.startsWith('http')) return;

        // Prefer the URL's extension only when it is a recognized document type;
        // Drive/Docs URLs rarely carry a real extension, so fall back to the
        // anchor text's extension, then to Drive mime-type inference.
        const urlExtension = getExtensionFromUrl(rawUrl);
        const textExtension = getExtensionFromText(anchorText);
        const fileType =
          (urlExtension ? SUPPORTED_EXTENSIONS[urlExtension] : undefined) ??
          (textExtension ? SUPPORTED_EXTENSIONS[textExtension] : undefined) ??
          inferGoogleDriveFileType(rawUrl) ??
          undefined;
        if (!fileType) return;

        if (links.has(rawUrl)) return;

        links.set(rawUrl, {
          url: rawUrl,
          fileName: getFileNameFromUrl(rawUrl, anchorText),
          fileType,
        });
      } catch {
        // Skip this candidate — malformed URL/attribute should never abort the scan.
      }
    };

    try {
      // Google Drive/Docs attachment links surfaced in classwork/announcement streams.
      document
        .querySelectorAll<HTMLAnchorElement>(
          'a[href*="drive.google.com"], a[href*="docs.google.com"], .attachment-link a, [data-attachment] a'
        )
        .forEach((a) => {
          try {
            addCandidate(a.href, a.textContent);
          } catch {
            // Malformed anchor element — skip and keep scanning.
          }
        });
    } catch {
      // querySelectorAll itself failed (non-standard/detached document) — return what we have.
    }

    return Array.from(links.values());
  },

  /** Construct a Google Classroom navigation URL for jumping to a cited source document. */
  buildCitationUrl(courseId: string, citation: CitationMetadata): string {
    try {
      const params = new URLSearchParams();
      params.set('search', citation.fileName);
      if (citation.pageNumber) params.set('page', String(citation.pageNumber));
      if (citation.sectionHeading) params.set('section', citation.sectionHeading);

      return `https://classroom.google.com/c/${courseId}/cw/all?${params.toString()}`;
    } catch {
      return '';
    }
  },
};
