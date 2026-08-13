import { describe, it, expect, beforeEach } from 'vitest';
import { AdapterRegistry } from '../../src/platform/registry';
import { d2lBrightspaceAdapter } from '../../src/platform/adapters/d2l-brightspace';
import { canvasAdapter } from '../../src/platform/adapters/canvas';
import { moodleAdapter } from '../../src/platform/adapters/moodle';
import { googleClassroomAdapter } from '../../src/platform/adapters/google-classroom';
import { blackboardAdapter } from '../../src/platform/adapters/blackboard';
import type { PlatformAdapter } from '../../src/types';

/** Minimal mock adapter factory for isolated priority-ordering tests. */
function makeMockAdapter(name: string, priority: number, urlPattern: RegExp): PlatformAdapter {
  return {
    name,
    urlPatterns: [urlPattern],
    priority,
    matchesUrl: (url: string) => urlPattern.test(url),
    isCoursePage: () => true,
    extractCourseId: () => null,
    extractCourseName: () => null,
    getDocumentLinks: () => [],
    buildCitationUrl: (courseId: string) => courseId,
  };
}

describe('AdapterRegistry', () => {
  describe('with the five real LMS adapters registered', () => {
    let registry: AdapterRegistry;

    beforeEach(() => {
      registry = new AdapterRegistry();
      registry.register(d2lBrightspaceAdapter);
      registry.register(canvasAdapter);
      registry.register(moodleAdapter);
      registry.register(googleClassroomAdapter);
      registry.register(blackboardAdapter);
    });

    it('lists all registered platforms in priority order', () => {
      expect(registry.getRegisteredPlatforms()).toEqual([
        'D2L Brightspace',
        'Canvas',
        'Moodle',
        'Google Classroom',
        'Blackboard',
      ]);
    });

    it('activates D2L Brightspace for a brightspace.com URL', () => {
      const active = registry.detectPlatform('https://mycourse.brightspace.com/d2l/home/1');
      expect(active?.name).toBe('D2L Brightspace');
      expect(registry.getActivePlatform()?.name).toBe('D2L Brightspace');
    });

    it('activates Canvas for an instructure.com URL', () => {
      const active = registry.detectPlatform('https://myschool.instructure.com/courses/123');
      expect(active?.name).toBe('Canvas');
    });

    it('activates Moodle for a course/view.php?id= URL', () => {
      const active = registry.detectPlatform('https://moodle.example.edu/course/view.php?id=42');
      expect(active?.name).toBe('Moodle');
    });

    it('activates Google Classroom for a classroom.google.com/c/ URL', () => {
      const active = registry.detectPlatform('https://classroom.google.com/c/NDU2Nzg5');
      expect(active?.name).toBe('Google Classroom');
    });

    it('activates Blackboard for an Ultra course URL', () => {
      const active = registry.detectPlatform('https://school.blackboard.com/ultra/courses/_12345_1/cl/outline');
      expect(active?.name).toBe('Blackboard');
    });

    it('activates Blackboard for an Original-view course_id URL', () => {
      const active = registry.detectPlatform('https://school.blackboard.com/webapps/blackboard/execute/courseMain?course_id=_12345_1');
      expect(active?.name).toBe('Blackboard');
    });

    it('returns null and clears the active platform for an unsupported URL', () => {
      const active = registry.detectPlatform('https://www.wikipedia.org/');
      expect(active).toBeNull();
      expect(registry.getActivePlatform()).toBeNull();
    });

    it('updates the active platform across successive detections (course context switching)', () => {
      registry.detectPlatform('https://myschool.instructure.com/courses/123');
      expect(registry.getActivePlatform()?.name).toBe('Canvas');

      registry.detectPlatform('https://moodle.example.edu/course/view.php?id=42');
      expect(registry.getActivePlatform()?.name).toBe('Moodle');
    });
  });

  describe('priority-based selection with overlapping mock adapters', () => {
    it('selects the lowest-priority-number adapter when multiple adapters match the same URL', () => {
      const registry = new AdapterRegistry();
      const lowPriority = makeMockAdapter('LowPriorityWins', 1, /example\.com/);
      const highPriorityNumber = makeMockAdapter('HighPriorityNumberLoses', 5, /example\.com/);

      // Register in reverse order to prove sorting — not insertion order — determines precedence.
      registry.register(highPriorityNumber);
      registry.register(lowPriority);

      const active = registry.detectPlatform('https://example.com/course/1');
      expect(active?.name).toBe('LowPriorityWins');
    });

    it('does not alter matching behavior for previously registered adapters when new ones are added', () => {
      const registry = new AdapterRegistry();
      const first = makeMockAdapter('First', 2, /platform-a\.com/);
      registry.register(first);

      expect(registry.detectPlatform('https://platform-a.com/course/1')?.name).toBe('First');

      // Register an unrelated adapter afterward.
      const second = makeMockAdapter('Second', 1, /platform-b\.com/);
      registry.register(second);

      // Previously matching URL still resolves to the same adapter.
      expect(registry.detectPlatform('https://platform-a.com/course/1')?.name).toBe('First');
      // New adapter's own URL resolves correctly too.
      expect(registry.detectPlatform('https://platform-b.com/course/1')?.name).toBe('Second');
    });

    it('returns null when no registered adapter matches', () => {
      const registry = new AdapterRegistry();
      registry.register(makeMockAdapter('OnlyAdapter', 1, /only-this\.com/));

      expect(registry.detectPlatform('https://not-this.com/')).toBeNull();
    });
  });
});
