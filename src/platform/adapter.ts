// ============================================================
// Platform Adapter Contract
// ------------------------------------------------------------
// The canonical `PlatformAdapter` interface (and its supporting
// `CitationMetadata` / `DocumentLink` types) is defined once in
// `src/types/index.ts` so it can be shared across the content
// script, service worker, and side panel without duplication.
//
// This module is the canonical import path for the platform
// layer (`src/platform/**`) and simply re-exports that contract
// so adapter implementations, the registry, and consumers of
// this layer can depend on `@/platform/adapter` instead of
// reaching into `@/types` directly.
//
// Per project rules, `src/types/index.ts` is never modified —
// this file must stay a thin re-export, not a redeclaration.
//
// Scope reminder: adapters only handle URL matching, course
// metadata extraction, and document link discovery. There is
// NO local chunking or vector storage in this layer — extracted
// text/links are handed off to the background scripts, which in
// turn delegate chunking, embedding, and storage to Backboard.io.
// ============================================================

export type { PlatformAdapter, CitationMetadata, DocumentLink } from '@/types';
