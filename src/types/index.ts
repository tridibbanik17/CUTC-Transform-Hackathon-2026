// ============================================================
// Core shared interfaces for LMS RAG Extension
// ============================================================

// --- Platform Adapter Types ---

export interface CitationMetadata {
  fileName: string;
  pageNumber: number;
  sectionHeading: string;
}

export interface DocumentLink {
  url: string;
  fileName: string;
  fileType: 'pdf' | 'pptx' | 'html' | 'png' | 'jpg' | 'jpeg' | 'txt' | 'md' | 'py' | 'java' | 'js' | 'cpp' | 'css' | 'csv' | 'ipynb' | 'docx' | 'doc' | 'odt';
  fileSize?: number;
  lastModified?: string;
}

export interface CourseMetadata {
  courseId: string;
  courseName: string;
  platform: string;
  pageUrl: string;
}

// --- Document Processing Types ---

export interface PageContent {
  pageNumber: number;
  headings: string[];
  text: string;
}

export interface ExtractedDocument {
  fileName: string;
  fileType: string;
  pages: PageContent[];
  totalCharacters: number;
}

// --- RAG Response Types ---

export interface Citation {
  fileName: string;
  pageNumber: number;
  sectionHeading: string;
  relevanceScore: number;
  sourceUrl?: string;
}

export interface RAGResponse {
  answer: string;
  citations: Citation[];
  confidenceScore: number;
  status: 'success' | 'low_confidence' | 'insufficient_information' | 'retrieval_error';
}

// --- Backboard.io Types ---

export interface IndexingResult {
  success: boolean;
  documentsIndexed: number;
  chunksCreated: number;
  failures: Array<{ fileName: string; error: string }>;
}

export interface CourseStatus {
  status: 'not_indexed' | 'indexing' | 'indexed';
  documentCount: number;
  chunkCount: number;
  lastIndexedAt?: string;
}

// --- Gemini Wrapper Types ---

export interface GeminiResponse {
  content: string;
  model: string;
  tokensUsed: number;
}

export type ModelRole = 'primary' | 'first-fallback' | 'second-fallback';

export interface FallbackModelConfig {
  id: string;
  role: ModelRole;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

// --- IndexedDB Types ---

export interface HistoryEntry {
  id: string;
  courseId: string;
  sessionId: string;
  query: string;
  response: RAGResponse;
  timestamp: string;
}

export interface PreferenceRecord {
  key: string;
  value: boolean | string;
  updatedAt: string;
}

export interface AdapterStateRecord {
  name: string;
  lastDetectedCourseId?: string;
  lastDetectedCourseName?: string;
  lastActiveAt: string;
}

// --- Interface Contracts ---

export interface APIKeyManager {
  storeKey(key: string): Promise<void>;
  getKey(): Promise<string | null>;
  getMaskedKey(): Promise<string | null>;
  validateKey(key: string): Promise<{ valid: boolean; error?: string }>;
  removeKey(): Promise<void>;
  hasKey(): Promise<boolean>;
}

export interface BackboardClient {
  indexDocument(params: {
    courseId: string;
    apiKey: string;
    document: ExtractedDocument;
    contentHash: string;
  }): Promise<IndexingResult>;

  hasDocument(courseId: string, apiKey: string, hash: string): Promise<boolean>;

  query(params: {
    courseId: string;
    apiKey: string;
    queryText: string;
  }): Promise<RAGResponse>;

  getCourseStatus(courseId: string, apiKey: string): Promise<CourseStatus>;

  replaceCourseIndex(
    courseId: string,
    apiKey: string,
    documents: ExtractedDocument[]
  ): Promise<IndexingResult>;

  deleteCourse(courseId: string, apiKey: string): Promise<void>;
}

export interface GeminiWrapper {
  execute(params: {
    apiKey: string;
    prompt: string;
    taskType: 'generation' | 'embedding' | 'vision' | 'ocr';
  }): Promise<GeminiResponse>;

  getLastUsedModel(): string;
  isExhausted(): boolean;
  resetChain(): void;
}

export interface DocumentProcessorAPI {
  fetchAndExtract(link: DocumentLink): Promise<ExtractedDocument>;
  computeDocumentHash(link: DocumentLink): Promise<string>;
}

export interface ScraperAPI {
  getCourseMetadata(): CourseMetadata | null;
  getDocumentLinks(): DocumentLink[];
  isSupportedCoursePage(): boolean;
  getActivePlatformName(): string | null;
}

export interface RAGEngineAPI {
  processQuery(courseId: string, query: string): Promise<RAGResponse>;
}

export interface PlatformAdapter {
  readonly name: string;
  readonly urlPatterns: RegExp[];
  readonly priority: number;

  matchesUrl(url: string): boolean;
  isCoursePage(document: Document): boolean;
  extractCourseId(url: string): string | null;
  extractCourseName(document: Document): string | null;
  getDocumentLinks(document: Document): DocumentLink[];
  buildCitationUrl(courseId: string, citation: CitationMetadata): string;
}

export interface AdapterRegistry {
  register(adapter: PlatformAdapter): void;
  detectPlatform(url: string): PlatformAdapter | null;
  getActivePlatform(): PlatformAdapter | null;
  getRegisteredPlatforms(): string[];
}
