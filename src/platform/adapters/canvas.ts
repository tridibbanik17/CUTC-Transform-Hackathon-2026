// ============================================================
// Canvas LMS Platform Adapter
// ------------------------------------------------------------
// Implements the PlatformAdapter contract for Canvas LMS,
// covering both Instructure-hosted domains (*.instructure.com)
// and self-hosted/custom-domain Canvas installations that still
// follow Canvas's `/courses/<id>/...` URL convention — including
// account-index prefixes (`/accounts/1/...`) and every course
// sub-tab (`/pages`, `/modules`, `/assignments`, `/discussion_topics`,
// `/files`, `/quizzes`, `/wiki`, etc.).
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

/** Instructure-hosted Canvas domains, e.g. https://myschool.instructure.com/... */
const INSTRUCTURE_PATTERN = /^https:\/\/[^/]*\.instructure\.com\//;

/**
 * Generic Canvas course path, present on both hosted and self-hosted/custom-domain
 * instances. Matches `/courses/<id>` with an optional `/accounts/<n>` account-index
 * prefix, and any course sub-page/tab that follows (pages, modules, assignments,
 * files, quizzes, discussion_topics, wiki, grades, etc.).
 */
const COURSES_PATH_PATTERN = /(?:\/accounts\/\d+)?\/courses\/\d+(?:\/[\w-]+)*\/?/;

/** Patterns that identify the numeric Canvas course identifier in a URL. */
const COURSE_ID_PATTERN = /\/courses\/(\d+)/;

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

/** Extracts an extension from free text (e.g. anchor text like "Lecture1.pdf"), if present. */
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

export const canvasAdapter: PlatformAdapter = {
  name: 'Canvas',

  urlPatterns: [INSTRUCTURE_PATTERN, COURSES_PATH_PATTERN],

  priority: 2,

  /** Detect Canvas URLs — Instructure-hosted domains or any domain using Canvas's `/courses/` convention. */
  matchesUrl(url: string): boolean {
    try {
      return this.urlPatterns.some((pattern) => pattern.test(url));
    } catch {
      return false;
    }
  },

  /**
   * Distinguish actual course pages (`/courses/<id>/...`, including any
   * sub-tab such as `/pages`, `/modules`, `/files`, `/assignments`) from
   * the global dashboard, login screens, or account/profile pages.
   * Never throws — any URL access failure resolves to `false`.
   */
  isCoursePage(document: Document): boolean {
    try {
      const url = safeDocumentUrl(document);
      if (!url) return false;
      if (/\/login/i.test(url)) return false;
      return COURSE_ID_PATTERN.test(url);
    } catch {
      return false;
    }
  },

  /**
   * Parse the numeric Canvas course identifier out of the `/courses/<id>`
   * URL segment, regardless of any account-index prefix or trailing
   * sub-page/tab. Never throws — returns `null` on any parsing failure.
   */
  extractCourseId(url: string): string | null {
    try {
      const match = url?.match(COURSE_ID_PATTERN);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Extract the course title from the page header / breadcrumb DOM.
   *
   * Tries several known Canvas header selectors (course title heading,
   * breadcrumb, course-menu heading, and any element carrying a
   * `data-testid="course-name"` attribute used in newer Canvas UI
   * revisions), then falls back to `document.title`, and finally a
   * generic string. Every DOM/string operation is individually
   * try/caught so a missing element, a detached node, or a synchronous
   * DOM exception can never throw out of this method or return
   * null/empty — it always resolves to a usable, non-empty string.
   */
  extractCourseName(document: Document): string | null {
    const selectors = [
      '.course-title',
      '#crumb_courses .ellipsible',
      '.ic-app-course-menu h2',
      '[data-testid="course-name"]',
      'header h1',
      'h1',
      'nav[aria-label="breadcrumbs"] li:last-child',
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        const text = el?.textContent?.trim();
        if (text) return text;
      } catch {
        // Selector failed on this pass — try the next one.
        continue;
      }
    }

    try {
      const rawTitle = document?.title ?? '';
      const titleText = rawTitle.split(':')[0]?.trim();
      if (titleText) return titleText;
    } catch {
      // document.title access failed — fall through to the generic fallback below.
    }

    return 'Unknown Course';
  },

  /**
   * Enumerate module/file document links from the page DOM, restricted
   * to supported file types. Every DOM query and per-element extraction
   * step is wrapped in try/catch so a non-standard node (missing `href`,
   * detached element, unexpected attribute shape) can never crash the
   * scan — it is simply skipped and extraction continues with the rest
   * of the page.
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
        // Canvas file/module links often end in `/download` with no extension, or
        // in a non-document suffix, so fall back to the anchor text's extension.
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
      // Canvas module item / file links: /courses/<id>/files/<fileId>/download, and
      // direct in-module attachment links.
      document
        .querySelectorAll<HTMLAnchorElement>(
          'a.instructure_file_link, a[href*="/files/"], a.attachment, .module-item-title a, a[href*="/download"]'
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

  /** Construct a Canvas navigation URL for jumping to a cited source document. */
  buildCitationUrl(courseId: string, citation: CitationMetadata): string {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const params = new URLSearchParams();
      params.set('search_term', citation.fileName);
      if (citation.pageNumber) params.set('page', String(citation.pageNumber));
      if (citation.sectionHeading) params.set('section', citation.sectionHeading);

      return `${origin}/courses/${courseId}/files?${params.toString()}`;
    } catch {
      return '';
    }
  },
};
