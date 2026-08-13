import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { blackboardAdapter } from '../../src/platform/adapters/blackboard';

/** Builds a jsdom Document with the given HTML body, located at the given URL. */
function buildDocument(html: string, url: string): Document {
  const dom = new JSDOM(html, { url });
  return dom.window.document;
}

describe('BlackboardAdapter', () => {
  describe('priority', () => {
    it('has priority 5', () => {
      expect(blackboardAdapter.priority).toBe(5);
    });
  });

  describe('matchesUrl', () => {
    it('matches the modern Ultra course view', () => {
      expect(blackboardAdapter.matchesUrl('https://school.blackboard.com/ultra/courses/_12345_1/cl/outline')).toBe(true);
    });

    it('matches the legacy Original view via a course_id query param', () => {
      expect(
        blackboardAdapter.matchesUrl('https://school.blackboard.com/webapps/blackboard/execute/courseMain?course_id=_12345_1')
      ).toBe(true);
    });

    it('matches other Original-view tool pages carrying course_id', () => {
      expect(
        blackboardAdapter.matchesUrl(
          'https://school.blackboard.com/webapps/blackboard/content/listContent.jsp?course_id=_12345_1&content_id=_999_1'
        )
      ).toBe(true);
    });

    it('does not match non-Blackboard URLs', () => {
      expect(blackboardAdapter.matchesUrl('https://myschool.instructure.com/courses/123')).toBe(false);
      expect(blackboardAdapter.matchesUrl('https://moodle.example.edu/course/view.php?id=42')).toBe(false);
      expect(blackboardAdapter.matchesUrl('https://classroom.google.com/c/abc123')).toBe(false);
      expect(blackboardAdapter.matchesUrl('https://example.com/webapps/other/thing')).toBe(false);
    });
  });

  describe('isCoursePage', () => {
    it('returns true for an Ultra course URL', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://school.blackboard.com/ultra/courses/_12345_1/cl/outline');
      expect(blackboardAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns true for an Original view URL with course_id', () => {
      const doc = buildDocument(
        '<html><body></body></html>',
        'https://school.blackboard.com/webapps/blackboard/execute/courseMain?course_id=_12345_1'
      );
      expect(blackboardAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns false for a login page', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://school.blackboard.com/webapps/login/');
      expect(blackboardAdapter.isCoursePage(doc)).toBe(false);
    });
  });

  describe('extractCourseId', () => {
    it('extracts the course id from an Ultra course URL', () => {
      expect(blackboardAdapter.extractCourseId('https://school.blackboard.com/ultra/courses/_12345_1/cl/outline')).toBe('_12345_1');
    });

    it('extracts the course id from the Original view course_id query param', () => {
      expect(
        blackboardAdapter.extractCourseId('https://school.blackboard.com/webapps/blackboard/execute/courseMain?course_id=_12345_1')
      ).toBe('_12345_1');
    });

    it('returns null when no course id is present', () => {
      expect(blackboardAdapter.extractCourseId('https://school.blackboard.com/webapps/portal/execute/tabs/tabAction')).toBeNull();
    });
  });

  describe('extractCourseName', () => {
    it('extracts course name from an Ultra-style header element', () => {
      const doc = buildDocument(
        '<html><body><h1 data-automation-id="courseTitle">Intro to Robotics</h1></body></html>',
        'https://school.blackboard.com/ultra/courses/_12345_1/cl/outline'
      );
      expect(blackboardAdapter.extractCourseName(doc)).toBe('Intro to Robotics');
    });

    it('extracts course name from an Original-view header element', () => {
      const doc = buildDocument(
        '<html><body><span id="courseMenuPalette_paletteTitleHeading">Discrete Math</span></body></html>',
        'https://school.blackboard.com/webapps/blackboard/execute/courseMain?course_id=_12345_1'
      );
      expect(blackboardAdapter.extractCourseName(doc)).toBe('Discrete Math');
    });

    it('falls back to document.title when no header element is present', () => {
      const doc = buildDocument(
        '<html><head><title>Statistics 101 | Blackboard Learn</title></head><body></body></html>',
        'https://school.blackboard.com/ultra/courses/_12345_1/cl/outline'
      );
      expect(blackboardAdapter.extractCourseName(doc)).toBe('Statistics 101');
    });

    it('falls back to a generic string when no header element or title is present', () => {
      const doc = buildDocument(
        '<html><head><title></title></head><body></body></html>',
        'https://school.blackboard.com/ultra/courses/_12345_1/cl/outline'
      );
      expect(blackboardAdapter.extractCourseName(doc)).toBe('Unknown Course');
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

      expect(() => blackboardAdapter.extractCourseName(brokenDocument)).not.toThrow();
      expect(blackboardAdapter.extractCourseName(brokenDocument)).toBe('Unknown Course');
    });
  });

  describe('getDocumentLinks', () => {
    it('extracts supported course content links and excludes unsupported types', () => {
      const html = `
        <html><body>
          <a href="https://school.blackboard.com/bbcswebdav/courses/_12345_1/Lecture1.pdf">Lecture 1.pdf</a>
          <a class="attachment" href="https://school.blackboard.com/bbcswebdav/courses/_12345_1/Slides.pptx">Slides.pptx</a>
          <a href="https://school.blackboard.com/bbcswebdav/courses/_12345_1/photo.gif">photo.gif</a>
        </body></html>
      `;
      const doc = buildDocument(html, 'https://school.blackboard.com/ultra/courses/_12345_1/cl/outline');
      const links = blackboardAdapter.getDocumentLinks(doc);

      expect(links.some((l) => l.fileType === 'pdf')).toBe(true);
      expect(links.some((l) => l.fileType === 'pptx')).toBe(true);
      expect(links).toHaveLength(2);
    });

    it('returns an empty array when no content links are present', () => {
      const doc = buildDocument('<html><body><p>Nothing here</p></body></html>', 'https://school.blackboard.com/ultra/courses/_12345_1/cl/outline');
      expect(blackboardAdapter.getDocumentLinks(doc)).toEqual([]);
    });

    it('deduplicates repeated links to the same URL', () => {
      const html = `
        <html><body>
          <a href="https://school.blackboard.com/bbcswebdav/courses/_12345_1/Notes.pdf">Notes.pdf</a>
          <a href="https://school.blackboard.com/bbcswebdav/courses/_12345_1/Notes.pdf">Notes.pdf</a>
        </body></html>
      `;
      const doc = buildDocument(html, 'https://school.blackboard.com/ultra/courses/_12345_1/cl/outline');
      expect(blackboardAdapter.getDocumentLinks(doc)).toHaveLength(1);
    });
  });

  describe('buildCitationUrl', () => {
    it('builds a citation URL containing the course id and file name', () => {
      const url = blackboardAdapter.buildCitationUrl('_12345_1', {
        fileName: 'Lecture1.pdf',
        pageNumber: 2,
        sectionHeading: 'Intro',
      });
      expect(url).toContain('/webapps/blackboard/execute/courseMain?');
      expect(url).toContain('course_id=_12345_1');
      expect(url).toContain('search=Lecture1.pdf');
      expect(url).toContain('page=2');
    });
  });
});
