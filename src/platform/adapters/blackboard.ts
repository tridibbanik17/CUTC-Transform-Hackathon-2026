// ============================================================
// Blackboard Learn Platform Adapter
// ------------------------------------------------------------
// Implements the PlatformAdapter contract for Blackboard Learn,
// covering both the modern "Ultra" course view
// (`/ultra/courses/<courseId>/...`) and the legacy "Original"
// course view, reached via
// `/webapps/blackboard/execute/courseMain?course_id=<courseId>`
// or any other `/webapps/blackboard/...` tool page carrying a
// `course_id` query parameter (`content/listContent.jsp`,
// `blackboard/content/listContentEditable.jsp`, etc.).
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

/** Modern "Ultra" course view: /ultra/courses/<courseId>/... */
const ULTRA_COURSE_PATTERN = /\/ultra\/courses\/([^/?#]+)/;

/** Legacy "Original" course view: any /webapps/blackboard/... URL carrying a course_id query param. */
const ORIGINAL_COURSE_PATTERN = /\/webapps\/blackboard\/[^?]*\?(?:[^#]*&)?course_id=([^&#]+)/i;

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

/** Derives a human-readable file name from a URL, falling back to provided anchor text. */
function getFileNameFromUrl(url: string, fallback?: string | null): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && /\.[a-z0-9]+$/i.test(last)) return decodeURIComponent(last);
  } catch {
    // ignore, fall through to fallback handling below
  }
  const trimmedFallback = fallback?.trim();
  return trimmedFallback && trimmedFallback.length > 0 ? trimmedFallback : url;
}

/** Safely reads the current document's URL without ever throwing. */
function safeDocumentUrl(document: Document): string {
  try {
    return document.location?.href ?? document.URL ?? '';
  } catch {
    return '';
  }
}

export const blackboardAdapter: PlatformAdapter = {
  name: 'Blackboard',

  urlPatterns: [ULTRA_COURSE_PATTERN, ORIGINAL_COURSE_PATTERN],

  priority: 5,

  /** Detect Blackboard URLs — Ultra course view or any Original ("webapps/blackboard") page carrying a course_id. */
  matchesUrl(url: string): boolean {
    try {
      return this.urlPatterns.some((pattern) => pattern.test(url));
    } catch {
      return false;
    }
  },

  /**
   * A URL matching either the Ultra course-view pattern or the Original
   * `course_id`-bearing webapps pattern is itself a course page — both
   * conventions are course-scoped by construction, so matching the URL
   * is sufficient confirmation. Never throws — any URL access failure
   * resolves to `false`.
   */
  isCoursePage(document: Document): boolean {
    try {
      const url = safeDocumentUrl(document);
      if (!url) return false;
      return ULTRA_COURSE_PATTERN.test(url) || ORIGINAL_COURSE_PATTERN.test(url);
    } catch {
      return false;
    }
  },

  /**
   * Parse the Blackboard course identifier out of either the Ultra
   * `/ultra/courses/<id>` URL segment or the Original `course_id` query
   * parameter. Never throws — returns `null` on any parsing failure.
   */
  extractCourseId(url: string): string | null {
    try {
      const ultraMatch = url?.match(ULTRA_COURSE_PATTERN);
      if (ultraMatch?.[1]) return decodeURIComponent(ultraMatch[1]);

      const originalMatch = url?.match(ORIGINAL_COURSE_PATTERN);
      if (originalMatch?.[1]) return decodeURIComponent(originalMatch[1]);

      return null;
    } catch {
      return null;
    }
  },

  /**
   * Extract the course title from the page header DOM.
   *
   * Tries several known Blackboard header selectors covering both the
   * Ultra UI (course header title, breadcrumb) and the Original UI
   * (`#courseMenuPalette_paletteTitleHeading`, module title bars), then
   * falls back to `document.title`, and finally a generic string. Every
   * DOM/string operation is individually try/caught so a missing
   * element, a detached node, or a synchronous DOM exception can never
   * throw out of this method or return null/empty — it always resolves
   * to a usable, non-empty string.
   */
  extractCourseName(document: Document): string | null {
    const selectors = [
      '[data-automation-id="courseTitle"]',
      '.coursetitle',
      '#courseMenuPalette_paletteTitleHeading',
      '.module-title-bar h2',
      'header h1',
      'h1',
    ];

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
      const titleText = rawTitle.split(' | ')[0]?.trim();
      if (titleText) return titleText;
    } catch {
      // document.title access failed — fall through to the generic fallback below.
    }

    return 'Unknown Course';
  },

  /**
   * Enumerate course content/attachment links from the page DOM,
   * restricted to supported file types. Every DOM query and per-element
   * extraction step is wrapped in try/catch so a non-standard node
   * (missing `href`, detached element, unexpected attribute shape) can
   * never crash the scan — it is simply skipped and extraction
   * continues with the rest of the page.
   */
  getDocumentLinks(document: Document): DocumentLink[] {
    const origin = (() => {
      try {
        return document.location?.origin ?? '';
      } catch {
        return '';
      }
    })();
    const links = new Map<string, DocumentLink>();

    const addCandidate = (rawUrl: string, anchorText?: string | null) => {
      try {
        if (!rawUrl) return;
        const absoluteUrl = rawUrl.startsWith('http')
          ? rawUrl
          : rawUrl.startsWith('/')
            ? `${origin}${rawUrl}`
            : null;
        if (!absoluteUrl) return;

        // Prefer the URL's extension only when it is a recognized document type —
        // Blackboard's bbcswebdav/content-attachment links and Original-view
        // "execute/..." view pages often carry no meaningful extension, so
        // fall back to the anchor text's extension in that case.
        const urlExtension = getExtensionFromUrl(absoluteUrl);
        const textExtension = getExtensionFromText(anchorText);
        const fileType =
          (urlExtension ? SUPPORTED_EXTENSIONS[urlExtension] : undefined) ??
          (textExtension ? SUPPORTED_EXTENSIONS[textExtension] : undefined);
        if (!fileType) return;

        if (links.has(absoluteUrl)) return;

        links.set(absoluteUrl, {
          url: absoluteUrl,
          fileName: getFileNameFromUrl(absoluteUrl, anchorText),
          fileType,
        });
      } catch {
        // Skip this candidate — malformed URL/attribute should never abort the scan.
      }
    };

    try {
      // Blackboard content attachment links: bbcswebdav content-storage URLs,
      // and generic content-item anchors in both Ultra and Original views.
      document
        .querySelectorAll<HTMLAnchorElement>(
          'a[href*="/bbcswebdav/"], a[href*="/webapps/blackboard/content/"], a.attachment, .item a[href], a[href*="/download/"]'
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

  /** Construct a Blackboard navigation URL for jumping to a cited source document. */
  buildCitationUrl(courseId: string, citation: CitationMetadata): string {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const params = new URLSearchParams();
      params.set('course_id', courseId);
      params.set('search', citation.fileName);
      if (citation.pageNumber) params.set('page', String(citation.pageNumber));
      if (citation.sectionHeading) params.set('section', citation.sectionHeading);

      return `${origin}/webapps/blackboard/execute/courseMain?${params.toString()}`;
    } catch {
      return '';
    }
  },
};
