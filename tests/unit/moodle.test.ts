import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { moodleAdapter } from '../../src/platform/adapters/moodle';

/** Builds a jsdom Document with the given HTML body, located at the given URL. */
function buildDocument(html: string, url: string): Document {
  const dom = new JSDOM(html, { url });
  return dom.window.document;
}

describe('MoodleAdapter', () => {
  describe('priority', () => {
    it('has priority 3', () => {
      expect(moodleAdapter.priority).toBe(3);
    });
  });

  describe('matchesUrl', () => {
    it('matches course/view.php?id= URLs', () => {
      expect(moodleAdapter.matchesUrl('https://moodle.example.edu/course/view.php?id=42')).toBe(true);
      expect(moodleAdapter.matchesUrl('https://learn.university.edu/course/view.php?section=2&id=17')).toBe(true);
    });

    it('does not match non-Moodle URLs', () => {
      expect(moodleAdapter.matchesUrl('https://mycourse.brightspace.com/d2l/home/1')).toBe(false);
      expect(moodleAdapter.matchesUrl('https://myschool.instructure.com/courses/123')).toBe(false);
      expect(moodleAdapter.matchesUrl('https://classroom.google.com/c/abc123')).toBe(false);
      expect(moodleAdapter.matchesUrl('https://example.com/course/view.php')).toBe(false);
    });
  });

  describe('isCoursePage', () => {
    it('returns true when the URL matches the course/view.php?id= pattern', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://moodle.example.edu/course/view.php?id=42');
      expect(moodleAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns false for non-course Moodle pages (e.g. login)', () => {
      const doc = buildDocument('<html><body></body></html>', 'https://moodle.example.edu/login/index.php');
      expect(moodleAdapter.isCoursePage(doc)).toBe(false);
    });
  });

  describe('extractCourseId', () => {
    it('extracts the numeric course id from the id query parameter', () => {
      expect(moodleAdapter.extractCourseId('https://moodle.example.edu/course/view.php?id=42')).toBe('42');
    });

    it('extracts the id when other query params precede it', () => {
      expect(moodleAdapter.extractCourseId('https://moodle.example.edu/course/view.php?section=2&id=17')).toBe('17');
    });

    it('returns null when no id is present', () => {
      expect(moodleAdapter.extractCourseId('https://moodle.example.edu/course/view.php')).toBeNull();
    });
  });

  describe('extractCourseName', () => {
    it('extracts course title from the page-header-headings element', () => {
      const doc = buildDocument(
        '<html><body><div class="page-header-headings"><h1>Linear Algebra 101</h1></div></body></html>',
        'https://moodle.example.edu/course/view.php?id=42'
      );
      expect(moodleAdapter.extractCourseName(doc)).toBe('Linear Algebra 101');
    });

    it('falls back to document.title when no header element is present', () => {
      const doc = buildDocument(
        '<html><head><title>Organic Chemistry</title></head><body></body></html>',
        'https://moodle.example.edu/course/view.php?id=42'
      );
      expect(moodleAdapter.extractCourseName(doc)).toBe('Organic Chemistry');
    });

    it('falls back to a generic string when no header element or title is present', () => {
      const doc = buildDocument('<html><head><title></title></head><body></body></html>', 'https://moodle.example.edu/course/view.php?id=42');
      expect(moodleAdapter.extractCourseName(doc)).toBe('Unknown Course');
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

      expect(() => moodleAdapter.extractCourseName(brokenDocument)).not.toThrow();
      expect(moodleAdapter.extractCourseName(brokenDocument)).toBe('Unknown Course');
    });
  });

  describe('isCoursePage: section-anchor variants', () => {
    it('returns true for a URL with a &section= query param', () => {
      const doc = buildDocument(
        '<html><body></body></html>',
        'https://moodle.example.edu/course/view.php?id=42&section=3'
      );
      expect(moodleAdapter.isCoursePage(doc)).toBe(true);
    });

    it('returns true for a URL with a #section-<n> hash', () => {
      const doc = buildDocument(
        '<html><body></body></html>',
        'https://moodle.example.edu/course/view.php?id=42#section-3'
      );
      expect(moodleAdapter.isCoursePage(doc)).toBe(true);
    });
  });

  describe('getDocumentLinks', () => {
    it('extracts supported section resource links (.pdf, .pptx) and excludes unsupported types', () => {
      const html = `
        <html><body>
          <li class="activity resource">
            <div class="activityinstance">
              <a href="https://moodle.example.edu/mod/resource/view.php?id=101">Week 1 Notes.pdf</a>
            </div>
          </li>
          <a href="https://moodle.example.edu/pluginfile.php/55/mod_resource/content/1/Slides.pptx">Slides.pptx</a>
          <a href="https://moodle.example.edu/mod/forum/view.php?id=9">Discussion Forum</a>
          <a href="https://moodle.example.edu/pluginfile.php/55/mod_resource/content/1/image.gif">image.gif</a>
        </body></html>
      `;
      const doc = buildDocument(html, 'https://moodle.example.edu/course/view.php?id=42');
      const links = moodleAdapter.getDocumentLinks(doc);

      expect(links).toHaveLength(2);
      expect(links.some((l) => l.fileType === 'pdf')).toBe(true);
      expect(links.some((l) => l.fileType === 'pptx')).toBe(true);
    });

    it('returns an empty array when no resource links are present', () => {
      const doc = buildDocument('<html><body><p>Nothing here</p></body></html>', 'https://moodle.example.edu/course/view.php?id=42');
      expect(moodleAdapter.getDocumentLinks(doc)).toEqual([]);
    });

    it('deduplicates repeated links to the same URL', () => {
      const html = `
        <html><body>
          <a href="https://moodle.example.edu/mod/resource/view.php?id=101">Notes.pdf</a>
          <a href="https://moodle.example.edu/mod/resource/view.php?id=101">Notes.pdf</a>
        </body></html>
      `;
      const doc = buildDocument(html, 'https://moodle.example.edu/course/view.php?id=42');
      expect(moodleAdapter.getDocumentLinks(doc)).toHaveLength(1);
    });
  });

  describe('buildCitationUrl', () => {
    it('builds a citation URL containing the course id and file name', () => {
      const url = moodleAdapter.buildCitationUrl('42', {
        fileName: 'Week1Notes.pdf',
        pageNumber: 2,
        sectionHeading: 'Overview',
      });
      expect(url).toContain('/course/view.php?');
      expect(url).toContain('id=42');
      expect(url).toContain('search=Week1Notes.pdf');
      expect(url).toContain('page=2');
    });
  });
});
