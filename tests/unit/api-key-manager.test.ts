import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiKeyManagerImpl } from '../../src/background/api-key-manager';

// Mock chrome.storage.local
const mockStorage: Record<string, string> = {};

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => {
        return { [key]: mockStorage[key] ?? undefined };
      }),
      set: vi.fn(async (items: Record<string, string>) => {
        Object.assign(mockStorage, items);
      }),
      remove: vi.fn(async (key: string) => {
        delete mockStorage[key];
      }),
    },
  },
};

// Assign chrome mock to global
vi.stubGlobal('chrome', chromeMock);

// Mock fetch for validateKey tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ApiKeyManagerImpl', () => {
  let manager: ApiKeyManagerImpl;

  beforeEach(() => {
    manager = new ApiKeyManagerImpl();
    // Clear storage
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    vi.clearAllMocks();
  });

  describe('storeKey', () => {
    it('stores a trimmed key in chrome.storage.local', async () => {
      await manager.storeKey('  AIzaSyB1234abcd5678efgh  ');

      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
        lms_rag_gemini_api_key: 'AIzaSyB1234abcd5678efgh',
      });
    });

    it('throws an error if key is empty', async () => {
      await expect(manager.storeKey('')).rejects.toThrow('API key cannot be empty');
    });

    it('throws an error if key is only whitespace', async () => {
      await expect(manager.storeKey('   ')).rejects.toThrow('API key cannot be empty');
    });
  });

  describe('getKey', () => {
    it('returns the stored key', async () => {
      mockStorage['lms_rag_gemini_api_key'] = 'AIzaSyBtestkey123';

      const key = await manager.getKey();
      expect(key).toBe('AIzaSyBtestkey123');
    });

    it('returns null when no key is stored', async () => {
      const key = await manager.getKey();
      expect(key).toBeNull();
    });
  });

  describe('getMaskedKey', () => {
    it('returns first 4 + last 4 characters with ... in between', async () => {
      mockStorage['lms_rag_gemini_api_key'] = 'AIzaSyB1234abcd5678efgh7x9Q';

      const masked = await manager.getMaskedKey();
      expect(masked).toBe('AIza...7x9Q');
    });

    it('returns null when no key is stored', async () => {
      const masked = await manager.getMaskedKey();
      expect(masked).toBeNull();
    });

    it('returns **** for very short keys (<=8 chars)', async () => {
      mockStorage['lms_rag_gemini_api_key'] = 'short';

      const masked = await manager.getMaskedKey();
      expect(masked).toBe('****');
    });
  });

  describe('validateKey', () => {
    it('returns valid: true for a valid key (200 response)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await manager.validateKey('AIzaSyBvalidkey123');
      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com/v1/models?key=AIzaSyBvalidkey123')
      );
    });

    it('returns valid: false with error for empty key', async () => {
      const result = await manager.validateKey('');
      expect(result).toEqual({ valid: false, error: 'API key cannot be empty' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns valid: false for 400 response (invalid format)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

      const result = await manager.validateKey('bad-key');
      expect(result).toEqual({ valid: false, error: 'Invalid API key format' });
    });

    it('returns valid: false for 401 response (unauthorized)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const result = await manager.validateKey('revoked-key');
      expect(result).toEqual({ valid: false, error: 'API key is unauthorized or has been revoked' });
    });

    it('returns valid: false for 403 response (forbidden)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

      const result = await manager.validateKey('forbidden-key');
      expect(result).toEqual({ valid: false, error: 'API key is unauthorized or has been revoked' });
    });

    it('returns valid: false with status for other error codes', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await manager.validateKey('some-key');
      expect(result).toEqual({ valid: false, error: 'Validation failed with status 500' });
    });

    it('returns valid: false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await manager.validateKey('some-key');
      expect(result).toEqual({
        valid: false,
        error: 'Network error during validation: Network timeout',
      });
    });
  });

  describe('removeKey', () => {
    it('removes the key from chrome.storage.local', async () => {
      mockStorage['lms_rag_gemini_api_key'] = 'AIzaSyBtestkey';

      await manager.removeKey();

      expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('lms_rag_gemini_api_key');
    });
  });

  describe('hasKey', () => {
    it('returns true when a key is stored', async () => {
      mockStorage['lms_rag_gemini_api_key'] = 'AIzaSyBtestkey';

      const result = await manager.hasKey();
      expect(result).toBe(true);
    });

    it('returns false when no key is stored', async () => {
      const result = await manager.hasKey();
      expect(result).toBe(false);
    });

    it('returns false when key is empty string', async () => {
      mockStorage['lms_rag_gemini_api_key'] = '';

      const result = await manager.hasKey();
      expect(result).toBe(false);
    });
  });

  describe('store/retrieve/remove lifecycle', () => {
    it('full lifecycle: store → get → mask → has → remove → has', async () => {
      // Store
      await manager.storeKey('AIzaSyB1234567890abcdefg');
      expect(mockStorage['lms_rag_gemini_api_key']).toBe('AIzaSyB1234567890abcdefg');

      // Get
      const key = await manager.getKey();
      expect(key).toBe('AIzaSyB1234567890abcdefg');

      // Mask
      const masked = await manager.getMaskedKey();
      expect(masked).toBe('AIza...defg');

      // Has
      expect(await manager.hasKey()).toBe(true);

      // Remove
      await manager.removeKey();

      // Has after remove
      expect(await manager.hasKey()).toBe(false);

      // Get after remove
      const keyAfter = await manager.getKey();
      expect(keyAfter).toBeNull();
    });
  });
});
