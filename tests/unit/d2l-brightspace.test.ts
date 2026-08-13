import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { d2lBrightspaceAdapter } from '../../src/platform/adapters/d2l-brightspace';

/** Builds a jsdom Document with the given HTML body, located at the given URL. */
function buildDocument(html: string, url: string): Document {
  const dom = new JSDOM(html, { url });
  return dom.window.document;
}

describe('D2LBrightspaceAdapter', () => {
  describe('priority', () => {
    it('has priority 1', () => {
      expect(d2lBrightspaceAdapter.priority).toBe(1);
    });
  });

  describe('matchesUrl', () => {
    it('matches hosted brightspace.com domains', () => {
      expect(d2lBrightspaceAdapter.matchesUrl('https://mycourse.brightspace.com/d2l/home/1')).toBe(true);
    });

    it('matches self-hosted /d2l/ instances', () => {
      expect(d2lBrightspaceAdapter.matchesUrl('https://learn.uwaterloo.ca/d2l/home/12345')).toBe(true);
    });

    it('does not match non-D2L URLs', () => {
      expect(d2lBrightspaceAdapter.matchesUrl('https://myschool.instructure.com/courses/123')).toBe(false);
      expect(d2lBrightspaceAdapter.matchesUrl('https://classroom.google.com/c/abc123')).toBe(false);
      expect(d2lBrightspaceAdapter.matchesUrl('https://example.com/')).toBe(false);
    });
  });

  describe('isCoursePage', () => {
    it('returns true for /d2l/le/content/<id> URLs', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://mycourse.brightspace.com/d2l/le/content/555/Home');
      expect(d2lBrightspaceAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns true for /d2l/le/lessons/<id> URLs', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://mycourse.brightspace.com/d2l/le/lessons/555/');
      expect(d2lBrightspaceAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns true for course-scoped /d2l/home/<ouId>', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://mycourse.brightspace.com/d2l/home/555');
      expect(d2lBrightspaceAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns true for tool pages carrying an ou= query param (dropbox/quizzing/grades)', () => {
      const doc = buildDocument(
        '<html><body></body></html>',
        'https://mycourse.brightspace.com/d2l/lms/dropbox/user/folders_list.d2l?ou=555'
      );
      expect(d2lBrightspaceAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns false for the bare dashboard (/d2l/home with no org unit id)', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://mycourse.brightspace.com/d2l/home');
      expect(d2lBrightspaceAdapter.isCoursePage(doc)).toBe(false);
    });

    it('returns false for the login page', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://mycourse.brightspace.com/d2l/login');
      expect(d2lBrightspaceAdapter.isCoursePage(doc)).toBe(false);
    });
  });

  describe('extractCourseId', () => {
    it('extracts the numeric org unit id from a content URL', () => {
      expect(d2lBrightspaceAdapter.extractCourseId('https://mycourse.brightspace.com/d2l/le/content/555/Home')).toBe('555');
    });

    it('extracts the numeric org unit id from a course-scoped home URL', () => {
      expect(d2lBrightspaceAdapter.extractCourseId('https://mycourse.brightspace.com/d2l/home/555')).toBe('555');
    });

    it('returns null when no org unit id is present', () => {
      expect(d2lBrightspaceAdapter.extractCourseId('https://mycourse.brightspace.com/d2l/home')).toBeNull();
    });
  });

  describe('extractCourseName', () => {
    it('extracts course name from the .d2l-page-title header element', () => {
      const doc = buildDocument(
        '<html><body><h1 class="d2l-page-title">Signals and Systems</h1></body></html>',
        'https://mycourse.brightspace.com/d2l/home/555'
      );
      expect(d2lBrightspaceAdapter.extractCourseName(doc)).toBe('Signals and Systems');
    });

    it('falls back to document.title when no header element is present', () => {
      const doc = buildDocument(
        '<html><head><title>Thermodynamics - Content</title></head><body></body></html>',
        'https://mycourse.brightspace.com/d2l/home/555'
      );
      expect(d2lBrightspaceAdapter.extractCourseName(doc)).toBe('Thermodynamics');
    });

    it('falls back to a generic string when no header element or title is present', () => {
      const doc = buildDocument('<html><head><title></title></head><body></body></html>', 'https://mycourse.brightspace.com/d2l/home/555');
      expect(d2lBrightspaceAdapter.extractCourseName(doc)).toBe('Unknown Course');
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

      expect(() => d2lBrightspaceAdapter.extractCourseName(brokenDocument)).not.toThrow();
      expect(d2lBrightspaceAdapter.extractCourseName(brokenDocument)).toBe('Unknown Course');
    });
  });

  describe('getDocumentLinks', () => {
    it('extracts supported course material links and excludes unsupported types', () => {
      const html = `
        <html><body>
          <a href="https://mycourse.brightspace.com/content/enforced/555-course/Lecture1.pdf">Lecture 1.pdf</a>
          <a href="https://mycourse.brightspace.com/d2l/le/content/555/topics/files/download/1/DirectFileTopicDownload">Slides.pptx</a>
          <a href="https://mycourse.brightspace.com/content/enforced/555-course/image.gif">image.gif</a>
        </body></html>
      `;
      const doc = buildDocument(html, 'https://mycourse.brightspace.com/d2l/le/content/555/Home');
      const links = d2lBrightspaceAdapter.getDocumentLinks(doc);

      expect(links.some((l) => l.fileType === 'pdf')).toBe(true);
      expect(links.every((l) => (l.url as string).indexOf('.gif') === -1)).toBe(true);
    });

    it('returns an empty array when no document links are present', () => {
      const doc = buildDocument('<html><body><p>Nothing here</p></body></html>', 'https://mycourse.brightspace.com/d2l/le/content/555/Home');
      expect(d2lBrightspaceAdapter.getDocumentLinks(doc)).toEqual([]);
    });

    it('never throws when querySelectorAll/innerHTML are unavailable', () => {
      const brokenDocument = {
        location: { origin: 'https://mycourse.brightspace.com' },
        querySelectorAll: () => {
          throw new Error('DOM access failed');
        },
        get documentElement(): never {
          throw new Error('innerHTML access failed');
        },
      } as unknown as Document;

      expect(() => d2lBrightspaceAdapter.getDocumentLinks(brokenDocument)).not.toThrow();
      expect(d2lBrightspaceAdapter.getDocumentLinks(brokenDocument)).toEqual([]);
    });
  });

  describe('buildCitationUrl', () => {
    it('builds a citation URL containing the course id and file name', () => {
      const url = d2lBrightspaceAdapter.buildCitationUrl('555', {
        fileName: 'Lecture1.pdf',
        pageNumber: 3,
        sectionHeading: 'Overview',
      });
      expect(url).toContain('/d2l/le/content/555/Home?');
      expect(url).toContain('fileName=Lecture1.pdf');
      expect(url).toContain('page=3');
    });
  });
});
