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
// ============================================================

import { AdapterRegistry } from './registry';
import { d2lBrightspaceAdapter } from './adapters/d2l-brightspace';

export const platformRegistry = new AdapterRegistry();

platformRegistry.register(d2lBrightspaceAdapter);

export { AdapterRegistry } from './registry';
export type { PlatformAdapter, CitationMetadata, DocumentLink } from '@/types';
export { d2lBrightspaceAdapter } from './adapters/d2l-brightspace';
