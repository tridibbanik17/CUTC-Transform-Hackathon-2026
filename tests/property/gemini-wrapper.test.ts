import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  GeminiWrapperImpl,
  GeminiApiError,
  GeminiChainExhaustedError,
  FALLBACK_CHAIN,
  RETRY_CONFIG,
} from '../../src/background/gemini-wrapper';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockErrorResponse(status: number, body = ''): Response {
  return {
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function mockSuccessResponse(text = 'Generated answer.', tokensUsed = 42): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () =>
      Promise.resolve({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { totalTokenCount: tokensUsed },
      }),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

const apiKey = 'AIzaSyTestKey1234567890';

describe('GeminiWrapperImpl', () => {
  let wrapper: GeminiWrapperImpl;

  beforeEach(() => {
    wrapper = new GeminiWrapperImpl();
    mockFetch.mockReset();
  });

  // =========================================================
  // Property 22: Fallback chain advancement
  // Given arbitrary sequences of 429/404, models must always be
  // attempted in order: gemini-3.6-flash -> gemini-3.5-flash-lite
  // -> gemini-2.5-flash-lite. Never skip, reverse, or repeat a
  // permanently exhausted model.
  // =========================================================
  describe('Property 22: Fallback chain advancement', () => {
    it('attempts models strictly in chain order for arbitrary 404/429 failure sequences', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.constantFrom(404, 429), { minLength: 0, maxLength: FALLBACK_CHAIN.length }),
          async (failStatuses) => {
            mockFetch.mockReset();
            const w = new GeminiWrapperImpl();

            for (const status of failStatuses) {
              mockFetch.mockResolvedValueOnce(mockErrorResponse(status));
            }
            const willSucceed = failStatuses.length < FALLBACK_CHAIN.length;
            if (willSucceed) {
              mockFetch.mockResolvedValueOnce(mockSuccessResponse());
            }

            if (willSucceed) {
              const result = await w.execute({ apiKey, prompt: 'test', taskType: 'generation' });
              expect(result.model).toBe(FALLBACK_CHAIN[failStatuses.length].id);
              expect(w.getLastUsedModel()).toBe(FALLBACK_CHAIN[failStatuses.length].id);
              expect(w.isExhausted()).toBe(false);
            } else {
              await expect(
                w.execute({ apiKey, prompt: 'test', taskType: 'generation' })
              ).rejects.toThrow(GeminiChainExhaustedError);
              expect(w.isExhausted()).toBe(true);
            }

            // Verify strict in-order attempt sequence — no skip, reverse, or repeat.
            const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
            expect(calledUrls.length).toBe(Math.min(failStatuses.length + 1, FALLBACK_CHAIN.length));
            calledUrls.forEach((url, idx) => {
              expect(url).toContain(`/${FALLBACK_CHAIN[idx].id}:generateContent`);
            });
          }
        ),
        { numRuns: 25 }
      );
    });
  });

  // =========================================================
  // Property 23: Server error retry
  // For 500/503: same model -> retry -> retry -> next model.
  // Maximum two additional retries, with 1s then 3s delays.
  // =========================================================
  describe('Property 23: Server error retry', () => {
    it('retries the same model up to 2 times on 500/503 before advancing', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(500, 503), async (serverStatus) => {
          vi.useFakeTimers();
          mockFetch.mockReset();
          const w = new GeminiWrapperImpl();

          // Primary model fails 3 times total (initial + 2 retries), then first-fallback succeeds.
          mockFetch
            .mockResolvedValueOnce(mockErrorResponse(serverStatus))
            .mockResolvedValueOnce(mockErrorResponse(serverStatus))
            .mockResolvedValueOnce(mockErrorResponse(serverStatus))
            .mockResolvedValueOnce(mockSuccessResponse());

          const promise = w.execute({ apiKey, prompt: 'test', taskType: 'generation' });
          await vi.runAllTimersAsync();
          const result = await promise;

          // 3 attempts against primary + 1 against first-fallback = 4 fetch calls
          expect(mockFetch).toHaveBeenCalledTimes(4);
          expect(mockFetch.mock.calls[0][0]).toContain(FALLBACK_CHAIN[0].id);
          expect(mockFetch.mock.calls[1][0]).toContain(FALLBACK_CHAIN[0].id);
          expect(mockFetch.mock.calls[2][0]).toContain(FALLBACK_CHAIN[0].id);
          expect(mockFetch.mock.calls[3][0]).toContain(FALLBACK_CHAIN[1].id);
          expect(result.model).toBe(FALLBACK_CHAIN[1].id);

          vi.useRealTimers();
        }),
        { numRuns: 5 }
      );
    });

    it('waits 1s before the first retry and 3s before the second retry', async () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      mockFetch
        .mockResolvedValueOnce(mockErrorResponse(503))
        .mockResolvedValueOnce(mockErrorResponse(503))
        .mockResolvedValueOnce(mockSuccessResponse());

      const promise = wrapper.execute({ apiKey, prompt: 'test', taskType: 'generation' });
      await vi.runAllTimersAsync();
      await promise;

      const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
      expect(delays).toContain(RETRY_CONFIG.baseDelayMs); // 1000
      expect(delays).toContain(RETRY_CONFIG.maxDelayMs); // 3000

      vi.useRealTimers();
    });
  });

  // =========================================================
  // Property 24: Fallback exhaustion
  // When all models return 404/429: cloud calls stop, and
  // isExhausted() reports true so callers can preserve existing
  // Backboard data and emit a daily-limit event instead of
  // continuing to call the API.
  // =========================================================
  describe('Property 24: Fallback exhaustion', () => {
    it('stops making cloud calls once the chain is exhausted', async () => {
      mockFetch
        .mockResolvedValueOnce(mockErrorResponse(404))
        .mockResolvedValueOnce(mockErrorResponse(429))
        .mockResolvedValueOnce(mockErrorResponse(404));

      await expect(
        wrapper.execute({ apiKey, prompt: 'test', taskType: 'generation' })
      ).rejects.toThrow(GeminiChainExhaustedError);

      expect(wrapper.isExhausted()).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(FALLBACK_CHAIN.length);

      // Subsequent calls must not make any further network requests.
      mockFetch.mockClear();
      await expect(
        wrapper.execute({ apiKey, prompt: 'another', taskType: 'generation' })
      ).rejects.toThrow(GeminiChainExhaustedError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('resetChain() restores the chain so cloud calls can resume', async () => {
      mockFetch
        .mockResolvedValueOnce(mockErrorResponse(404))
        .mockResolvedValueOnce(mockErrorResponse(404))
        .mockResolvedValueOnce(mockErrorResponse(404));

      await expect(
        wrapper.execute({ apiKey, prompt: 'test', taskType: 'generation' })
      ).rejects.toThrow(GeminiChainExhaustedError);
      expect(wrapper.isExhausted()).toBe(true);

      wrapper.resetChain();
      expect(wrapper.isExhausted()).toBe(false);

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockSuccessResponse());

      const result = await wrapper.execute({ apiKey, prompt: 'test', taskType: 'generation' });
      expect(result.model).toBe(FALLBACK_CHAIN[0].id);
      expect(mockFetch.mock.calls[0][0]).toContain(FALLBACK_CHAIN[0].id);
    });
  });

  // =========================================================
  // Client errors: fail immediately, no retry, no advance
  // =========================================================
  describe('Client errors (400/401/403)', () => {
    it.each([400, 401, 403])('fails immediately on %i without retrying or advancing', async (status) => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(status));

      await expect(
        wrapper.execute({ apiKey, prompt: 'test', taskType: 'generation' })
      ).rejects.toThrow(GeminiApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(wrapper.isExhausted()).toBe(false);
      expect(wrapper.getLastUsedModel()).toBe('');
    });

    it('does not advance the model pointer after a client error, so a later success uses the same model', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(401));
      await expect(
        wrapper.execute({ apiKey, prompt: 'test', taskType: 'generation' })
      ).rejects.toThrow(GeminiApiError);

      mockFetch.mockResolvedValueOnce(mockSuccessResponse());
      const result = await wrapper.execute({ apiKey, prompt: 'retry', taskType: 'generation' });
      expect(result.model).toBe(FALLBACK_CHAIN[0].id);
    });
  });

  // =========================================================
  // getLastUsedModel / resetChain basics
  // =========================================================
  describe('getLastUsedModel / resetChain', () => {
    it('returns empty string before any successful call', () => {
      expect(wrapper.getLastUsedModel()).toBe('');
    });

    it('returns the model that handled the most recent successful request', async () => {
      mockFetch.mockResolvedValueOnce(mockSuccessResponse());
      await wrapper.execute({ apiKey, prompt: 'test', taskType: 'generation' });
      expect(wrapper.getLastUsedModel()).toBe(FALLBACK_CHAIN[0].id);
    });

    it('resetChain() sets isExhausted() back to false and restarts from the primary model', async () => {
      mockFetch
        .mockResolvedValueOnce(mockErrorResponse(404))
        .mockResolvedValueOnce(mockSuccessResponse());

      const result = await wrapper.execute({ apiKey, prompt: 'test', taskType: 'generation' });
      expect(result.model).toBe(FALLBACK_CHAIN[1].id);

      wrapper.resetChain();

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockSuccessResponse());
      const result2 = await wrapper.execute({ apiKey, prompt: 'test2', taskType: 'generation' });
      expect(mockFetch.mock.calls[0][0]).toContain(FALLBACK_CHAIN[0].id);
      expect(result2.model).toBe(FALLBACK_CHAIN[0].id);
    });
  });

  // =========================================================
  // Response parsing
  // =========================================================
  describe('Response parsing', () => {
    it('returns content, model, and tokensUsed from a successful response', async () => {
      mockFetch.mockResolvedValueOnce(mockSuccessResponse('The answer is 42.', 123));

      const result = await wrapper.execute({ apiKey, prompt: 'test', taskType: 'generation' });

      expect(result.content).toBe('The answer is 42.');
      expect(result.model).toBe(FALLBACK_CHAIN[0].id);
      expect(result.tokensUsed).toBe(123);
    });

    it('never includes the raw API key in a thrown error message', async () => {
      vi.useFakeTimers();
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const promise = wrapper.execute({
        apiKey: 'AIzaSySECRET_KEY_VALUE',
        prompt: 'test',
        taskType: 'generation',
      });
      // Attach a handler immediately so the retry/advance rejections
      // that occur while fake timers are advanced don't register as
      // "unhandled" before the try/catch below awaits the promise.
      promise.catch(() => {});
      await vi.runAllTimersAsync();

      try {
        await promise;
        throw new Error('expected execute() to reject');
      } catch (err) {
        expect((err as Error).message).not.toContain('AIzaSySECRET_KEY_VALUE');
        if (err instanceof GeminiApiError) {
          expect(err.responseBody ?? '').not.toContain('AIzaSySECRET_KEY_VALUE');
        }
      }

      vi.useRealTimers();
    });
  });
});
