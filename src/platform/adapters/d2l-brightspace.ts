// ============================================================
// D2L Brightspace Platform Adapter
// ------------------------------------------------------------
// Implements the PlatformAdapter contract for D2L Brightspace
// instances, regardless of institutional branding — covering
// both hosted (*.brightspace.com) and self-hosted (*/d2l/*)
// deployments such as Avenue to Learn and Waterloo LEARN.
//
// Scope: URL matching, course metadata extraction, and document
// link discovery only. No local chunking or vector storage is
// performed here — extracted links/text are handed off upstream
// to the document processor and, ultimately, Backboard.io.
// ============================================================

import type { PlatformAdapter, DocumentLink, CitationMetadata } from '@/types';

/** Hosted D2L Brightspace domains, e.g. https://mycourse.brightspace.com/... */
const HOSTED_PATTERN = /^https:\/\/[^/]*\.brightspace\.com\//;

/** Self-hosted D2L instances, e.g. https://learn.example.edu/d2l/... */
const SELF_HOSTED_PATTERN = /^https:\/\/[^/]*\/d2l\//;

/** Patterns that identify a numeric D2L "org unit" (course) identifier in a URL. */
const COURSE_ID_PATTERNS: RegExp[] = [
  /\/d2l\/le\/content\/(\d+)/i,
  /\/d2l\/le\/lessons\/(\d+)/i,
  /\/d2l\/lms\/dropbox\/[^?]*[?&]ou=(\d+)/i,
  /\/d2l\/home\/(\d+)/i,
  /[?&]ou=(\d+)/i,
];

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
    const path = parsed.pathname;
    const match = path.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    const withoutQuery = url.split(/[?#]/)[0];
    const match = withoutQuery.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : null;
  }
}

/** Derives a human-readable file name from a URL, falling back to provided anchor text. */
function getFileNameFromUrl(url: string, fallback?: string | null): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return decodeURIComponent(last);
  } catch {
    // ignore, fall through to fallback handling below
  }
  const trimmedFallback = fallback?.trim();
  return trimmedFallback && trimmedFallback.length > 0 ? trimmedFallback : url;
}

/** Best-effort extraction of a file size string (e.g. "133 KB") near a link element. */
function findNearbySizeText(el: Element): number | undefined {
  const container = el.closest('li, tr, .d2l-list-item, .d2l-datalist-item') ?? el.parentElement;
  const text = container?.textContent ?? '';
  const match = text.match(/([\d.]+)\s*(KB|MB|GB)/i);
  if (!match) return undefined;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier = unit === 'GB' ? 1024 * 1024 * 1024 : unit === 'MB' ? 1024 * 1024 : 1024;
  return Math.round(value * multiplier);
}

/** Best-effort extraction of a last-modified date string near a link element. */
function findNearbyDateText(el: Element): string | undefined {
  const container = el.closest('li, tr, .d2l-list-item, .d2l-datalist-item') ?? el.parentElement;
  const timeEl = container?.querySelector('time[datetime]');
  const datetime = timeEl?.getAttribute('datetime');
  return datetime ?? undefined;
}

export const d2lBrightspaceAdapter: PlatformAdapter = {
  name: 'D2L Brightspace',

  urlPatterns: [HOSTED_PATTERN, SELF_HOSTED_PATTERN],

  priority: 1,

  /** Detect D2L URLs (hosted or self-hosted) regardless of institutional branding. */
  matchesUrl(url: string): boolean {
    return this.urlPatterns.some((pattern) => pattern.test(url));
  },

  /**
   * Distinguish actual course shells from general dashboard/login pages.
   * Course shells live under `/d2l/le/content/`, `/d2l/le/lessons/`, or a
   * course-scoped `/d2l/home/<ouId>` — as opposed to the bare `/d2l/home`
   * dashboard or `/d2l/login`-style authentication pages.
   */
  isCoursePage(document: Document): boolean {
    const url = document.location?.href ?? document.URL ?? '';

    if (/\/d2l\/login/i.test(url)) return false;
    if (/\/d2l\/le\/content\//i.test(url)) return true;
    if (/\/d2l\/le\/lessons\//i.test(url)) return true;
    if (/\/d2l\/home\/\d+/i.test(url)) return true;

    // Bare dashboard (/d2l/home with no org unit id) is not a course page.
    return false;
  },

  /** Parse the numeric D2L org unit (course) identifier out of the URL structure. */
  extractCourseId(url: string): string | null {
    for (const pattern of COURSE_ID_PATTERNS) {
      const match = url.match(pattern);
      if (match?.[1]) return match[1];
    }
    return null;
  },

  /** Extract the course title from the page header DOM. */
  extractCourseName(document: Document): string | null {
    const headerEl = document.querySelector(
      '.d2l-page-title, .d2l-navigation-s-header-logo-area, [class*="course-name"], h1.vui-heading-1'
    );
    const headerText = headerEl?.textContent?.trim();
    if (headerText) return headerText;

    const titleText = document.title?.split(' - ')[0]?.trim();
    return titleText && titleText.length > 0 ? titleText : null;
  },

  /** Enumerate course material links from the page DOM, restricted to supported file types. */
  getDocumentLinks(document: Document): DocumentLink[] {
    const origin = document.location?.origin ?? '';
    const links = new Map<string, DocumentLink>();

    const addCandidate = (rawUrl: string, anchorText?: string | null, el?: Element) => {
      if (!rawUrl) return;
      const absoluteUrl = rawUrl.startsWith('http')
        ? rawUrl
        : rawUrl.startsWith('/')
          ? `${origin}${rawUrl}`
          : null;
      if (!absoluteUrl) return;

      const extension = getExtensionFromUrl(absoluteUrl);
      const fileType = extension ? SUPPORTED_EXTENSIONS[extension] : undefined;
      if (!fileType) return;

      if (links.has(absoluteUrl)) return;

      links.set(absoluteUrl, {
        url: absoluteUrl,
        fileName: getFileNameFromUrl(absoluteUrl, anchorText),
        fileType,
        fileSize: el ? findNearbySizeText(el) : undefined,
        lastModified: el ? findNearbyDateText(el) : undefined,
      });
    };

    // Direct anchors pointing at course content / downloads.
    document
      .querySelectorAll<HTMLAnchorElement>(
        'a[href*="/content/enforced/"], a[href*="/topics/files/download/"], a[href*="/content/"], a[download]'
      )
      .forEach((a) => addCandidate(a.href, a.textContent, a));

    // D2L's DirectFileTopicDownload pattern embedded in page markup.
    const pageHtml = document.documentElement.innerHTML;
    const downloadMatches = pageHtml.match(/\/d2l\/le\/content\/\d+\/topics\/files\/download\/[^"'\s<>]+/gi) ?? [];
    downloadMatches.forEach((path) => addCandidate(`${origin}${path}`));

    const enforcedMatches = pageHtml.match(/\/content\/enforced\/[^"'\s<>]+\.[a-zA-Z0-9]+/gi) ?? [];
    enforcedMatches.forEach((path) => addCandidate(`${origin}${path}`));

    return Array.from(links.values());
  },

  /** Construct a structured D2L navigation URL for jumping to a cited source document. */
  buildCitationUrl(courseId: string, citation: CitationMetadata): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const params = new URLSearchParams();
    params.set('fileName', citation.fileName);
    if (citation.pageNumber) params.set('page', String(citation.pageNumber));
    if (citation.sectionHeading) params.set('section', citation.sectionHeading);

    return `${origin}/d2l/le/content/${courseId}/Home?${params.toString()}`;
  },
};
