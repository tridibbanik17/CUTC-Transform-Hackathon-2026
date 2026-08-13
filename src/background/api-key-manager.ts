// ============================================================
// API Key Manager - BYOK (Bring Your Own Key)
// Manages the user's Google Gemini API key lifecycle:
// storage, validation, retrieval, masking, and removal.
// Keys stored in chrome.storage.local for immediate access.
// ============================================================

import type { APIKeyManager } from '@/types';
import { fetchWithTimeout, FetchTimeoutError } from '@/shared/fetch-with-timeout';

const STORAGE_KEY = 'lms_rag_gemini_api_key';
const GEMINI_MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1/models';
const VALIDATE_KEY_TIMEOUT_MS = 10000;

export class ApiKeyManagerImpl implements APIKeyManager {
  /**
   * Store a validated API key in chrome.storage.local.
   */
  async storeKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) {
      throw new Error('API key cannot be empty');
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
  }

  /**
   * Retrieve the full API key for transmission to Backboard.io.
   */
  async getKey(): Promise<string | null> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] ?? null;
  }

  /**
   * Return masked display version (e.g., "AIza...7x9Q" — first 4 + last 4 chars).
   */
  async getMaskedKey(): Promise<string | null> {
    const key = await this.getKey();
    if (!key) return null;
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  /**
   * Validate the key by making a lightweight test request to Gemini API (models.list endpoint).
   * Returns { valid: true } on success, or { valid: false, error } on failure.
   */
  async validateKey(key: string): Promise<{ valid: boolean; error?: string }> {
    const trimmed = key.trim();
    if (!trimmed) {
      return { valid: false, error: 'API key cannot be empty' };
    }

    try {
      const response = await fetchWithTimeout(
        `${GEMINI_MODELS_ENDPOINT}?key=${encodeURIComponent(trimmed)}`,
        {},
        VALIDATE_KEY_TIMEOUT_MS
      );

      if (response.ok) {
        return { valid: true };
      }

      if (response.status === 400) {
        return { valid: false, error: 'Invalid API key format' };
      }

      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: 'API key is unauthorized or has been revoked' };
      }

      return { valid: false, error: `Validation failed with status ${response.status}` };
    } catch (err) {
      if (err instanceof FetchTimeoutError) {
        return { valid: false, error: 'Validation request timed out. Please check your connection and try again.' };
      }
      return {
        valid: false,
        error: `Network error during validation: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Remove the stored key from local storage.
   */
  async removeKey(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
  }

  /**
   * Check if a valid key is currently configured.
   */
  async hasKey(): Promise<boolean> {
    const key = await this.getKey();
    return key !== null && key.length > 0;
  }
}

/** Singleton instance for use across the extension */
export const apiKeyManager = new ApiKeyManagerImpl();
