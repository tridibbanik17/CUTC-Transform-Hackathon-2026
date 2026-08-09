// ============================================================
// Message types for communication between extension contexts
// (Service Worker ↔ Content Script ↔ Side Panel)
// ============================================================

import type { CourseMetadata, DocumentLink, RAGResponse, CourseStatus, IndexingResult } from './index';

// --- Request Messages (sent TO service worker) ---

export interface GetCourseInfoMessage {
  type: 'GET_COURSE_INFO';
}

export interface StartIndexingMessage {
  type: 'START_INDEXING';
  payload: { courseId: string };
}

export interface ProcessQueryMessage {
  type: 'PROCESS_QUERY';
  payload: { courseId: string; query: string };
}

export interface GetIndexStatusMessage {
  type: 'GET_INDEX_STATUS';
  payload: { courseId: string };
}

export interface DeleteCourseDataMessage {
  type: 'DELETE_COURSE_DATA';
  payload: { courseId: string };
}

export interface ReIndexMessage {
  type: 'RE_INDEX';
  payload: { courseId: string };
}

export interface GetActivePlatformMessage {
  type: 'GET_ACTIVE_PLATFORM';
}

export interface GetFallbackStatusMessage {
  type: 'GET_FALLBACK_STATUS';
}

export interface ValidateApiKeyMessage {
  type: 'VALIDATE_API_KEY';
  payload: { key: string };
}

export interface GetApiKeyStatusMessage {
  type: 'GET_API_KEY_STATUS';
}

export type ServiceWorkerMessage =
  | GetCourseInfoMessage
  | StartIndexingMessage
  | ProcessQueryMessage
  | GetIndexStatusMessage
  | DeleteCourseDataMessage
  | ReIndexMessage
  | GetActivePlatformMessage
  | GetFallbackStatusMessage
  | ValidateApiKeyMessage
  | GetApiKeyStatusMessage;

// --- Response Messages (sent FROM service worker) ---

export interface CourseInfoResponse {
  type: 'COURSE_INFO_RESPONSE';
  payload: CourseMetadata | null;
}

export interface IndexingProgressResponse {
  type: 'INDEXING_PROGRESS';
  payload: {
    current: number;
    total: number;
    percentage: number;
    currentFile: string;
  };
}

export interface IndexingCompleteResponse {
  type: 'INDEXING_COMPLETE';
  payload: IndexingResult;
}

export interface QueryResponse {
  type: 'QUERY_RESPONSE';
  payload: RAGResponse;
}

export interface IndexStatusResponse {
  type: 'INDEX_STATUS_RESPONSE';
  payload: CourseStatus;
}

export interface PlatformDetectedResponse {
  type: 'PLATFORM_DETECTED';
  payload: { platformName: string | null };
}

export interface FallbackStatusResponse {
  type: 'FALLBACK_STATUS_RESPONSE';
  payload: {
    exhausted: boolean;
    lastUsedModel: string;
  };
}

export interface ApiKeyStatusResponse {
  type: 'API_KEY_STATUS_RESPONSE';
  payload: {
    hasKey: boolean;
    maskedKey: string | null;
  };
}

export interface ErrorResponse {
  type: 'ERROR';
  payload: {
    message: string;
    code?: string;
  };
}

export type ServiceWorkerResponse =
  | CourseInfoResponse
  | IndexingProgressResponse
  | IndexingCompleteResponse
  | QueryResponse
  | IndexStatusResponse
  | PlatformDetectedResponse
  | FallbackStatusResponse
  | ApiKeyStatusResponse
  | ErrorResponse;

// --- Content Script Messages ---

export interface ContentScriptCourseInfo {
  type: 'CONTENT_COURSE_INFO';
  payload: {
    metadata: CourseMetadata | null;
    documentLinks: DocumentLink[];
  };
}

export interface ContentScriptPlatformDetected {
  type: 'CONTENT_PLATFORM_DETECTED';
  payload: { platformName: string | null };
}

export type ContentScriptMessage =
  | ContentScriptCourseInfo
  | ContentScriptPlatformDetected;
