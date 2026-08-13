import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { googleClassroomAdapter } from '../../src/platform/adapters/google-classroom';

/** Builds a jsdom Document with the given HTML body, located at the given URL. */
function buildDocument(html: string, url: string): Document {
  const dom = new JSDOM(html, { url });
  return dom.window.document;
}

describe('GoogleClassroomAdapter', () => {
  describe('priority', () => {
    it('has priority 4', () => {
      expect(googleClassroomAdapter.priority).toBe(4);
    });
  });

  describe('matchesUrl', () => {
    it('matches classroom.google.com/c/<id> URLs', () => {
      expect(googleClassroomAdapter.matchesUrl('https://classroom.google.com/c/NDU2Nzg5')).toBe(true);
      expect(googleClassroomAdapter.matchesUrl('https://classroom.google.com/c/NDU2Nzg5/a/details')).toBe(true);
    });

    it('does not match non-Classroom URLs', () => {
      expect(googleClassroomAdapter.matchesUrl('https://mycourse.brightspace.com/d2l/home/1')).toBe(false);
      expect(googleClassroomAdapter.matchesUrl('https://myschool.instructure.com/courses/123')).toBe(false);
      expect(googleClassroomAdapter.matchesUrl('https://moodle.example.edu/course/view.php?id=42')).toBe(false);
      expect(googleClassroomAdapter.matchesUrl('https://classroom.google.com/')).toBe(false);
      expect(googleClassroomAdapter.matchesUrl('https://classroom.google.com/h')).toBe(false);
    });
  });

  describe('isCoursePage', () => {
    it('returns true for a URL matching classroom.google.com/c/<id>', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://classroom.google.com/c/NDU2Nzg5/cw/all');
      expect(googleClassroomAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns false for the Classroom home/dashboard page', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://classroom.google.com/h');
      expect(googleClassroomAdapter.isCoursePage(doc)).toBe(false);
    });
  });

  describe('extractCourseId', () => {
    it('extracts the course id from the /c/<id> URL segment', () => {
      expect(googleClassroomAdapter.extractCourseId('https://classroom.google.com/c/NDU2Nzg5/cw/all')).toBe('NDU2Nzg5');
    });

    it('returns null when no course id is present', () => {
      expect(googleClassroomAdapter.extractCourseId('https://classroom.google.com/h')).toBeNull();
    });
  });

  describe('extractCourseName', () => {
    it('extracts course name from the header title element', () => {
      const doc = buildDocument(
        '<html><body><h1 class="aXCTVb">Biology 202</h1></body></html>',
        'https://classroom.google.com/c/NDU2Nzg5'
      );
      expect(googleClassroomAdapter.extractCourseName(doc)).toBe('Biology 202');
    });

    it('falls back to document.title when no header element is present', () => {
      const doc = buildDocument(
        '<html><head><title>World History - Classroom</title></head><body></body></html>',
        'https://classroom.google.com/c/NDU2Nzg5'
      );
      expect(googleClassroomAdapter.extractCourseName(doc)).toBe('World History');
    });

    it('falls back to a generic string when no header element or title is present', () => {
      const doc = buildDocument('<html><head><title></title></head><body></body></html>', 'https://classroom.google.com/c/NDU2Nzg5');
      expect(googleClassroomAdapter.extractCourseName(doc)).toBe('Unknown Course');
    });

    it('never throws even when document.title and querySelector are unavailable', () => {
      // Simulate a hostile/incomplete Document-like object to prove extractCourseName
      // is defensive against DOM access exceptions rather than null-pointer-crashing.
      const brokenDocument = {
        querySelector: () => {
          throw new Error('DOM access failed');
        },
        get title(): string {
          throw new Error('title access failed');
        },
      } as unknown as Document;

      expect(() => googleClassroomAdapter.extractCourseName(brokenDocument)).not.toThrow();
      expect(googleClassroomAdapter.extractCourseName(brokenDocument)).toBe('Unknown Course');
    });
  });

  describe('getDocumentLinks', () => {
    it('extracts supported Drive/attached document links and excludes unsupported types', () => {
      const html = `
        <html><body>
          <div class="attachment-link">
            <a href="https://drive.google.com/file/d/abc123/view">Homework1.pdf</a>
          </div>
          <a href="https://docs.google.com/presentation/d/xyz789/edit">Lecture Slides</a>
          <a href="https://drive.google.com/file/d/def456/view">photo.gif</a>
          <a href="https://classroom.google.com/c/NDU2Nzg5/a/details">Assignment details</a>
        </body></html>
      `;
      const doc = buildDocument(html, 'https://classroom.google.com/c/NDU2Nzg5/cw/all');
      const links = googleClassroomAdapter.getDocumentLinks(doc);

      expect(links.some((l) => l.fileType === 'pdf')).toBe(true);
      expect(links.some((l) => l.fileType === 'pptx')).toBe(true);
      expect(links).toHaveLength(2);
    });

    it('returns an empty array when no attachment links are present', () => {
      const doc = buildDocument('<html><body><p>No attachments</p></body></html>', 'https://classroom.google.com/c/NDU2Nzg5');
      expect(googleClassroomAdapter.getDocumentLinks(doc)).toEqual([]);
    });

    it('deduplicates repeated links to the same URL', () => {
      const html = `
        <html><body>
          <a href="https://drive.google.com/file/d/abc123/view">Homework1.pdf</a>
          <a href="https://drive.google.com/file/d/abc123/view">Homework1.pdf</a>
        </body></html>
      `;
      const doc = buildDocument(html, 'https://classroom.google.com/c/NDU2Nzg5');
      expect(googleClassroomAdapter.getDocumentLinks(doc)).toHaveLength(1);
    });
  });

  describe('buildCitationUrl', () => {
    it('builds a citation URL containing the course id and file name', () => {
      const url = googleClassroomAdapter.buildCitationUrl('NDU2Nzg5', {
        fileName: 'Homework1.pdf',
        pageNumber: 1,
        sectionHeading: 'Problem Set',
      });
      expect(url).toContain('https://classroom.google.com/c/NDU2Nzg5/cw/all?');
      expect(url).toContain('search=Homework1.pdf');
      expect(url).toContain('page=1');
    });
  });
});
