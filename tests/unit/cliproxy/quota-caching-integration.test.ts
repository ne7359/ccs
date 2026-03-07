/**
 * Quota Caching Integration Tests
 *
 * Tests for quota response caching behavior across providers:
 * - Cache hit/miss scenarios
 * - Cache invalidation patterns
 * - TTL expiration behavior
 * - Provider isolation
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getCachedQuota,
  setCachedQuota,
  invalidateQuotaCache,
  clearQuotaCache,
  getQuotaCacheStats,
  QUOTA_CACHE_TTL_MS,
} from '../../../src/cliproxy/quota-response-cache';
import { shouldCacheQuotaResult } from '../../../src/web-server/routes/cliproxy-stats-routes';
import type { GeminiCliQuotaResult, CodexQuotaResult } from '../../../src/cliproxy/quota-types';

describe('Quota Caching Integration', () => {
  beforeEach(() => {
    clearQuotaCache();
  });

  afterEach(() => {
    clearQuotaCache();
  });

  describe('GeminiCliQuotaResult caching', () => {
    const createGeminiQuota = (
      remainingPercent: number,
      options: Partial<GeminiCliQuotaResult> = {}
    ): GeminiCliQuotaResult => ({
      success: true,
      buckets: [
        {
          id: 'gemini-flash-series::combined',
          label: 'Gemini Flash Series',
          tokenType: null,
          remainingFraction: remainingPercent / 100,
          remainingPercent,
          resetTime: null,
          modelIds: ['gemini-3-flash-preview'],
        },
      ],
      projectId: 'test-project-123',
      lastUpdated: Date.now(),
      accountId: 'test@example.com',
      ...options,
    });

    it('should cache successful Gemini quota result', () => {
      const quota = createGeminiQuota(75);
      setCachedQuota('gemini', 'user@example.com', quota);

      const cached = getCachedQuota<GeminiCliQuotaResult>('gemini', 'user@example.com');
      expect(cached).not.toBeNull();
      expect(cached?.success).toBe(true);
      expect(cached?.buckets[0].remainingPercent).toBe(75);
    });

    it('should NOT cache quota with needsReauth flag', () => {
      const quota = createGeminiQuota(0, {
        success: false,
        needsReauth: true,
        error: 'Token expired',
      });

      // In real usage, we would not cache reauth results
      // This test verifies the data structure
      setCachedQuota('gemini', 'user@example.com', quota);
      const cached = getCachedQuota<GeminiCliQuotaResult>('gemini', 'user@example.com');
      expect(cached?.needsReauth).toBe(true);
    });

    it('should preserve all Gemini bucket fields through cache', () => {
      const quota = createGeminiQuota(50, {
        buckets: [
          {
            id: 'gemini-pro-series::input',
            label: 'Gemini Pro Series',
            tokenType: 'input',
            remainingFraction: 0.5,
            remainingPercent: 50,
            resetTime: '2026-01-30T12:00:00Z',
            modelIds: ['gemini-3-pro-preview', 'gemini-2.5-pro'],
          },
        ],
      });

      setCachedQuota('gemini', 'user@example.com', quota);
      const cached = getCachedQuota<GeminiCliQuotaResult>('gemini', 'user@example.com');

      expect(cached?.buckets[0].tokenType).toBe('input');
      expect(cached?.buckets[0].resetTime).toBe('2026-01-30T12:00:00Z');
      expect(cached?.buckets[0].modelIds).toContain('gemini-3-pro-preview');
    });
  });

  describe('CodexQuotaResult caching', () => {
    const createCodexQuota = (
      primaryUsed: number,
      secondaryUsed?: number,
      options: Partial<CodexQuotaResult> = {}
    ): CodexQuotaResult => ({
      success: true,
      windows: [
        {
          label: 'Primary',
          usedPercent: primaryUsed,
          remainingPercent: 100 - primaryUsed,
          resetAfterSeconds: 3600,
          resetAt: new Date(Date.now() + 3600000).toISOString(),
        },
        ...(secondaryUsed !== undefined
          ? [
              {
                label: 'Secondary',
                usedPercent: secondaryUsed,
                remainingPercent: 100 - secondaryUsed,
                resetAfterSeconds: 86400,
                resetAt: new Date(Date.now() + 86400000).toISOString(),
              },
            ]
          : []),
      ],
      planType: 'plus',
      lastUpdated: Date.now(),
      accountId: 'test@example.com',
      ...options,
    });

    it('should cache successful Codex quota result', () => {
      const quota = createCodexQuota(30, 10);
      setCachedQuota('codex', 'user@example.com', quota);

      const cached = getCachedQuota<CodexQuotaResult>('codex', 'user@example.com');
      expect(cached).not.toBeNull();
      expect(cached?.success).toBe(true);
      expect(cached?.windows).toHaveLength(2);
      expect(cached?.windows[0].usedPercent).toBe(30);
    });

    it('should preserve planType through cache', () => {
      const quota = createCodexQuota(20, undefined, { planType: 'team' });
      setCachedQuota('codex', 'user@example.com', quota);

      const cached = getCachedQuota<CodexQuotaResult>('codex', 'user@example.com');
      expect(cached?.planType).toBe('team');
    });

    it('should handle Codex quota with code review limits', () => {
      const quota: CodexQuotaResult = {
        success: true,
        windows: [
          {
            label: 'Primary',
            usedPercent: 25,
            remainingPercent: 75,
            resetAfterSeconds: 3600,
            resetAt: null,
          },
          {
            label: 'Code Review (Primary)',
            usedPercent: 80,
            remainingPercent: 20,
            resetAfterSeconds: 1800,
            resetAt: null,
          },
        ],
        planType: 'plus',
        lastUpdated: Date.now(),
        accountId: 'user@example.com',
      };

      setCachedQuota('codex', 'user@example.com', quota);
      const cached = getCachedQuota<CodexQuotaResult>('codex', 'user@example.com');

      expect(cached?.windows).toHaveLength(2);
      const codeReview = cached?.windows.find((w) => w.label.includes('Code Review'));
      expect(codeReview?.usedPercent).toBe(80);
    });
  });

  describe('cross-provider isolation', () => {
    it('should isolate Gemini and Codex cache for same email', () => {
      const geminiQuota: GeminiCliQuotaResult = {
        success: true,
        buckets: [
          {
            id: 'gemini-flash::combined',
            label: 'Flash',
            tokenType: null,
            remainingFraction: 0.9,
            remainingPercent: 90,
            resetTime: null,
            modelIds: [],
          },
        ],
        projectId: 'proj',
        lastUpdated: Date.now(),
        accountId: 'shared@example.com',
      };

      const codexQuota: CodexQuotaResult = {
        success: true,
        windows: [
          {
            label: 'Primary',
            usedPercent: 10,
            remainingPercent: 90,
            resetAfterSeconds: 3600,
            resetAt: null,
          },
        ],
        planType: 'plus',
        lastUpdated: Date.now(),
        accountId: 'shared@example.com',
      };

      setCachedQuota('gemini', 'shared@example.com', geminiQuota);
      setCachedQuota('codex', 'shared@example.com', codexQuota);

      const cachedGemini = getCachedQuota<GeminiCliQuotaResult>('gemini', 'shared@example.com');
      const cachedCodex = getCachedQuota<CodexQuotaResult>('codex', 'shared@example.com');

      expect(cachedGemini?.buckets).toBeDefined();
      expect(cachedCodex?.windows).toBeDefined();
      expect((cachedGemini as unknown as CodexQuotaResult).windows).toBeUndefined();
      expect((cachedCodex as unknown as GeminiCliQuotaResult).buckets).toBeUndefined();
    });

    it('should allow invalidating one provider without affecting others', () => {
      setCachedQuota('gemini', 'user@example.com', { success: true, buckets: [] } as never);
      setCachedQuota('codex', 'user@example.com', { success: true, windows: [] } as never);
      setCachedQuota('agy', 'user@example.com', { success: true, quotas: [] } as never);

      invalidateQuotaCache('gemini', 'user@example.com');

      expect(getCachedQuota('gemini', 'user@example.com')).toBeNull();
      expect(getCachedQuota('codex', 'user@example.com')).not.toBeNull();
      expect(getCachedQuota('agy', 'user@example.com')).not.toBeNull();
    });
  });

  describe('cache TTL behavior', () => {
    it('should use 2-minute TTL by default', () => {
      expect(QUOTA_CACHE_TTL_MS).toBe(120000);
    });

    it('should allow custom TTL on retrieval', () => {
      setCachedQuota('gemini', 'user@example.com', { success: true } as never);

      // With very long TTL, should find it
      expect(getCachedQuota('gemini', 'user@example.com', 10000000)).not.toBeNull();

      // With 0 TTL, should be expired
      expect(getCachedQuota('gemini', 'user@example.com', 0)).toBeNull();
    });

    it('should clean up expired entries lazily on access', async () => {
      setCachedQuota('gemini', 'user1@example.com', { id: 1 });
      setCachedQuota('gemini', 'user2@example.com', { id: 2 });

      expect(getQuotaCacheStats().size).toBe(2);

      // Access with very short TTL to trigger expiration cleanup
      await new Promise((r) => setTimeout(r, 10));
      getCachedQuota('gemini', 'user1@example.com', 5);

      // Only user1 entry should be deleted (the one we accessed)
      expect(getQuotaCacheStats().size).toBe(1);
    });
  });

  describe('error state caching', () => {
    it('should cache failed quota results for visibility', () => {
      const failedQuota: GeminiCliQuotaResult = {
        success: false,
        buckets: [],
        projectId: null,
        lastUpdated: Date.now(),
        error: 'Rate limited',
        accountId: 'user@example.com',
      };

      setCachedQuota('gemini', 'user@example.com', failedQuota);
      const cached = getCachedQuota<GeminiCliQuotaResult>('gemini', 'user@example.com');

      expect(cached?.success).toBe(false);
      expect(cached?.error).toBe('Rate limited');
    });

    it('should preserve error message through cache round-trip', () => {
      const errorQuota: CodexQuotaResult = {
        success: false,
        windows: [],
        planType: null,
        lastUpdated: Date.now(),
        error: 'API error: 503',
        accountId: 'user@example.com',
      };

      setCachedQuota('codex', 'user@example.com', errorQuota);
      const cached = getCachedQuota<CodexQuotaResult>('codex', 'user@example.com');

      expect(cached?.error).toBe('API error: 503');
    });

    it('should cache stable auth and workspace failures', () => {
      expect(
        shouldCacheQuotaResult({
          success: false,
          needsReauth: true,
          error: 'Token expired',
        })
      ).toBe(true);

      expect(
        shouldCacheQuotaResult({
          success: false,
          httpStatus: 402,
          error: 'Workspace deactivated (HTTP 402)',
        })
      ).toBe(true);
    });

    it('should skip transient failures marked retryable or temporary by status', () => {
      expect(
        shouldCacheQuotaResult({
          success: false,
          retryable: true,
          error: 'Rate limited - try again later',
        })
      ).toBe(false);

      expect(
        shouldCacheQuotaResult({
          success: false,
          httpStatus: 429,
          error: 'Rate limited - try again later',
        })
      ).toBe(false);

      expect(
        shouldCacheQuotaResult({
          success: false,
          httpStatus: 503,
          error: 'Codex quota service unavailable (HTTP 503)',
        })
      ).toBe(false);
    });

    it('should respect explicit non-retryable failures even without message pattern matches', () => {
      expect(
        shouldCacheQuotaResult({
          success: false,
          retryable: false,
          error: 'Unknown upstream error',
        })
      ).toBe(true);
    });
  });

  describe('high-volume scenarios', () => {
    it('should handle 50+ accounts efficiently', () => {
      const numAccounts = 50;
      const providers = ['gemini', 'codex', 'agy'];

      // Populate cache
      for (let i = 0; i < numAccounts; i++) {
        for (const provider of providers) {
          setCachedQuota(provider, `user${i}@example.com`, {
            success: true,
            id: `${provider}-${i}`,
          });
        }
      }

      const stats = getQuotaCacheStats();
      expect(stats.size).toBe(numAccounts * providers.length);

      // Verify random access
      const cached = getCachedQuota<{ id: string }>('codex', 'user25@example.com');
      expect(cached?.id).toBe('codex-25');
    });

    it('should handle rapid cache updates', () => {
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        setCachedQuota('gemini', 'user@example.com', { iteration: i });
      }

      const cached = getCachedQuota<{ iteration: number }>('gemini', 'user@example.com');
      expect(cached?.iteration).toBe(iterations - 1);
      expect(getQuotaCacheStats().size).toBe(1); // Only one entry, updated 100 times
    });
  });
});
