// ============================================================
// Platform Layer Entry Point
// ------------------------------------------------------------
// Instantiates the shared AdapterRegistry and registers all
// available Platform_Adapters. Other modules (content script,
// service worker) should import `platformRegistry` from here
// rather than constructing their own registry instance.
//
// New LMS platforms are supported by implementing the
// PlatformAdapter interface and registering them below —
// no changes to core components are required.
//
// Registered adapters (priority, lowest = highest precedence):
//   1. D2L Brightspace
//   2. Canvas
//   3. Moodle
//   4. Google Classroom
//   5. Blackboard
// ============================================================

import { AdapterRegistry } from './registry';
import { d2lBrightspaceAdapter } from './adapters/d2l-brightspace';
import { canvasAdapter } from './adapters/canvas';
import { moodleAdapter } from './adapters/moodle';
import { googleClassroomAdapter } from './adapters/google-classroom';
import { blackboardAdapter } from './adapters/blackboard';

export const platformRegistry = new AdapterRegistry();

platformRegistry.register(d2lBrightspaceAdapter);
platformRegistry.register(canvasAdapter);
platformRegistry.register(moodleAdapter);
platformRegistry.register(googleClassroomAdapter);
platformRegistry.register(blackboardAdapter);

export { AdapterRegistry } from './registry';
export type { PlatformAdapter, CitationMetadata, DocumentLink } from '@/types';
export { d2lBrightspaceAdapter } from './adapters/d2l-brightspace';
export { canvasAdapter } from './adapters/canvas';
export { moodleAdapter } from './adapters/moodle';
export { googleClassroomAdapter } from './adapters/google-classroom';
export { blackboardAdapter } from './adapters/blackboard';
