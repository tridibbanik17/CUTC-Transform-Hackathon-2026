import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { canvasAdapter } from '../../src/platform/adapters/canvas';

/** Builds a jsdom Document with the given HTML body, located at the given URL. */
function buildDocument(html: string, url: string): Document {
  const dom = new JSDOM(html, { url });
  return dom.window.document;
}

describe('CanvasAdapter', () => {
  describe('priority', () => {
    it('has priority 2', () => {
      expect(canvasAdapter.priority).toBe(2);
    });
  });

  describe('matchesUrl', () => {
    it('matches Instructure-hosted Canvas domains', () => {
      expect(canvasAdapter.matchesUrl('https://myschool.instructure.com/courses/123')).toBe(true);
      expect(canvasAdapter.matchesUrl('https://myschool.instructure.com/')).toBe(true);
    });

    it('matches self-hosted/custom-domain Canvas via the /courses/ convention', () => {
      expect(canvasAdapter.matchesUrl('https://learn.mycollege.edu/courses/456/assignments')).toBe(true);
    });

    it('matches course sub-pages/tabs (pages, modules, files, quizzes, discussion_topics)', () => {
      expect(canvasAdapter.matchesUrl('https://myschool.instructure.com/courses/123/pages')).toBe(true);
      expect(canvasAdapter.matchesUrl('https://myschool.instructure.com/courses/123/modules')).toBe(true);
      expect(canvasAdapter.matchesUrl('https://myschool.instructure.com/courses/123/files')).toBe(true);
      expect(canvasAdapter.matchesUrl('https://myschool.instructure.com/courses/123/quizzes/9')).toBe(true);
      expect(canvasAdapter.matchesUrl('https://myschool.instructure.com/courses/123/discussion_topics/4')).toBe(true);
    });

    it('matches URLs with an /accounts/<n>/ prefix before /courses/<id>', () => {
      expect(canvasAdapter.matchesUrl('https://learn.mycollege.edu/accounts/1/courses/456/assignments')).toBe(true);
    });

    it('does not match non-Canvas URLs', () => {
      expect(canvasAdapter.matchesUrl('https://mycourse.brightspace.com/d2l/home/1')).toBe(false);
      expect(canvasAdapter.matchesUrl('https://classroom.google.com/c/abc123')).toBe(false);
      expect(canvasAdapter.matchesUrl('https://example.com/course/view.php?id=5')).toBe(false);
      expect(canvasAdapter.matchesUrl('https://www.google.com/search?q=canvas')).toBe(false);
    });
  });

  describe('isCoursePage', () => {
    it('returns true for a URL containing /courses/<id>', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://myschool.instructure.com/courses/789/modules');
      expect(canvasAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns false for the login page', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://myschool.instructure.com/login/canvas');
      expect(canvasAdapter.isCoursePage(doc)).toBe(false);
    });

    it('returns false for the global dashboard (no course id)', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://myschool.instructure.com/');
      expect(canvasAdapter.isCoursePage(doc)).toBe(false);
    });
  });

  describe('extractCourseId', () => {
    it('extracts the numeric course id from a /courses/<id> URL', () => {
      expect(canvasAdapter.extractCourseId('https://myschool.instructure.com/courses/456/assignments')).toBe('456');
    });

    it('returns null when no course id is present', () => {
      expect(canvasAdapter.extractCourseId('https://myschool.instructure.com/dashboard')).toBeNull();
    });
  });

  describe('extractCourseName', () => {
    it('extracts course name from the .course-title header element', () => {
      const doc = buildDocument(
        '<html><body><h1 class="course-title">Intro to Algorithms</h1></body></html>',
        'https://myschool.instructure.com/courses/123'
      );
      expect(canvasAdapter.extractCourseName(doc)).toBe('Intro to Algorithms');
    });

    it('falls back to document.title when no header element is present', () => {
      const doc = buildDocument(
        '<html><head><title>Data Structures: Course Modules</title></head><body></body></html>',
        'https://myschool.instructure.com/courses/123'
      );
      expect(canvasAdapter.extractCourseName(doc)).toBe('Data Structures');
    });

    it('falls back to a generic string when no header element or title is present', () => {
      const doc = buildDocument('<html><head><title></title></head><body></body></html>', 'https://myschool.instructure.com/courses/123');
      expect(canvasAdapter.extractCourseName(doc)).toBe('Unknown Course');
    });

    it('never throws even when document.title and querySelector are unavailable', () => {
      const brokenDocument = {
        querySelector: () => {
          throw new Error('DOM access failed');
        },
        get title(): string {
          throw new Error('title access failed');
        },
      } as unknown as Document;

      expect(() => canvasAdapter.extractCourseName(brokenDocument)).not.toThrow();
      expect(canvasAdapter.extractCourseName(brokenDocument)).toBe('Unknown Course');
    });
  });

  describe('getDocumentLinks', () => {
    it('extracts supported document links (.pdf, .pptx) and excludes unsupported types', () => {
      const html = `
        <html><body>
          <div class="module-item-title">
            <a href="https://myschool.instructure.com/courses/123/files/1/download">Lecture 1.pdf</a>
          </div>
          <a class="instructure_file_link" href="https://myschool.instructure.com/courses/123/files/2/download">Slides.pptx</a>
          <a href="https://myschool.instructure.com/courses/123/files/3/download">image.gif</a>
          <a href="https://myschool.instructure.com/courses/123/quizzes/1">Quiz 1</a>
        </body></html>
      `;
      const doc = buildDocument(html, 'https://myschool.instructure.com/courses/123/modules');
      const links = canvasAdapter.getDocumentLinks(doc);

      expect(links).toHaveLength(2);
      expect(links.some((l) => l.fileType === 'pdf')).toBe(true);
      expect(links.some((l) => l.fileType === 'pptx')).toBe(true);
      expect(links.every((l) => l.fileType !== 'gif' as never)).toBe(true);
    });

    it('returns an empty array when no document links are present', () => {
      const doc = buildDocument('<html><body><p>No files here</p></body></html>', 'https://myschool.instructure.com/courses/123');
      expect(canvasAdapter.getDocumentLinks(doc)).toEqual([]);
    });

    it('deduplicates repeated links to the same URL', () => {
      const html = `
        <html><body>
          <a href="https://myschool.instructure.com/courses/123/files/1/download">Notes.pdf</a>
          <a href="https://myschool.instructure.com/courses/123/files/1/download">Notes.pdf (again)</a>
        </body></html>
      `;
      const doc = buildDocument(html, 'https://myschool.instructure.com/courses/123');
      const links = canvasAdapter.getDocumentLinks(doc);
      expect(links).toHaveLength(1);
    });
  });

  describe('buildCitationUrl', () => {
    it('builds a citation URL containing the course id and file name', () => {
      const url = canvasAdapter.buildCitationUrl('123', {
        fileName: 'Lecture1.pdf',
        pageNumber: 4,
        sectionHeading: 'Introduction',
      });
      expect(url).toContain('/courses/123/files?');
      expect(url).toContain('search_term=Lecture1.pdf');
      expect(url).toContain('page=4');
    });
  });
});
