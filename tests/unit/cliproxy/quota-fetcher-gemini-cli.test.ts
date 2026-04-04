/**
 * Gemini CLI Quota Fetcher Unit Tests
 *
 * Tests for Gemini CLI bucket parsing and transformation logic
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getCapturedFetchRequests, mockFetch, restoreFetch } from '../../mocks';

describe('Gemini CLI Quota Fetcher', () => {
  const GEMINI_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
  const GEMINI_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
  const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
  let tempHome: string;
  let originalCcsHome: string | undefined;
  let originalCcsDir: string | undefined;
  let originalGeminiClientId: string | undefined;
  let originalGeminiClientSecret: string | undefined;
  let moduleVersion = 0;
  let buildGeminiCliBuckets: typeof import('../../../src/cliproxy/quota-fetcher-gemini-cli').buildGeminiCliBuckets;
  let fetchGeminiCliQuota: typeof import('../../../src/cliproxy/quota-fetcher-gemini-cli').fetchGeminiCliQuota;
  let resolveGeminiCliProjectId: typeof import('../../../src/cliproxy/quota-fetcher-gemini-cli').resolveGeminiCliProjectId;
  let geminiTestExports: typeof import('../../../src/cliproxy/quota-fetcher-gemini-cli').__testExports;
  let refreshGeminiToken: typeof import('../../../src/cliproxy/auth/gemini-token-refresh').refreshGeminiToken;
  let getProviderAuthDir: typeof import('../../../src/cliproxy/config-generator').getProviderAuthDir;

  function writeGeminiToken(token: Record<string, unknown>): string {
    const authDir = getProviderAuthDir('gemini');
    fs.mkdirSync(authDir, { recursive: true });
    const tokenPath = path.join(authDir, 'gemini-test.json');
    fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
    return tokenPath;
  }

  function writeActiveGeminiAccount(
    accountId: string,
    overrides: Record<string, unknown> = {}
  ): string {
    return writeGeminiToken({
      type: 'gemini',
      email: accountId,
      project_id: 'cloudaicompanion-test-123',
      token: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expiry: Date.now() + 60 * 60 * 1000,
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        token_uri: GOOGLE_TOKEN_URL,
      },
      ...overrides,
    });
  }

  beforeEach(async () => {
    moduleVersion += 1;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-gemini-refresh-'));
    originalCcsHome = process.env.CCS_HOME;
    originalCcsDir = process.env.CCS_DIR;
    originalGeminiClientId = process.env.CCS_GEMINI_OAUTH_CLIENT_ID;
    originalGeminiClientSecret = process.env.CCS_GEMINI_OAUTH_CLIENT_SECRET;
    process.env.CCS_HOME = tempHome;

    delete process.env.CCS_GEMINI_OAUTH_CLIENT_ID;
    delete process.env.CCS_GEMINI_OAUTH_CLIENT_SECRET;
    delete process.env.CCS_DIR;

    const configGenerator = await import(
      `../../../src/cliproxy/config-generator?gemini-config-generator=${moduleVersion}`
    );
    ({
      buildGeminiCliBuckets,
      fetchGeminiCliQuota,
      resolveGeminiCliProjectId,
      __testExports: geminiTestExports,
    } = await import(
      `../../../src/cliproxy/quota-fetcher-gemini-cli?gemini-quota-fetcher=${moduleVersion}`
    ));
    ({ refreshGeminiToken } = await import(
      `../../../src/cliproxy/auth/gemini-token-refresh?gemini-refresh=${moduleVersion}`
    ));
    ({ getProviderAuthDir } = configGenerator);
  });

  afterEach(() => {
    restoreFetch();
    fs.rmSync(tempHome, { recursive: true, force: true });

    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
    }

    if (originalCcsDir === undefined) {
      delete process.env.CCS_DIR;
    } else {
      process.env.CCS_DIR = originalCcsDir;
    }

    if (originalGeminiClientId === undefined) {
      delete process.env.CCS_GEMINI_OAUTH_CLIENT_ID;
    } else {
      process.env.CCS_GEMINI_OAUTH_CLIENT_ID = originalGeminiClientId;
    }

    if (originalGeminiClientSecret === undefined) {
      delete process.env.CCS_GEMINI_OAUTH_CLIENT_SECRET;
    } else {
      process.env.CCS_GEMINI_OAUTH_CLIENT_SECRET = originalGeminiClientSecret;
    }
  });

  describe('resolveGeminiCliProjectId', () => {
    it('should extract project ID from account field', () => {
      const account = 'user@example.com (cloudaicompanion-abc-123)';
      const projectId = resolveGeminiCliProjectId(account);
      expect(projectId).toBe('cloudaicompanion-abc-123');
    });

    it('should return last parenthetical when multiple exist', () => {
      const account = 'user (org) (cloudaicompanion-xyz-789)';
      const projectId = resolveGeminiCliProjectId(account);
      expect(projectId).toBe('cloudaicompanion-xyz-789');
    });

    it('should return null for account without parentheses', () => {
      const account = 'user@example.com';
      const projectId = resolveGeminiCliProjectId(account);
      expect(projectId).toBeNull();
    });

    it('should return null for empty string', () => {
      const projectId = resolveGeminiCliProjectId('');
      expect(projectId).toBeNull();
    });

    it('should handle nested parentheses', () => {
      const account = 'user@example.com (project-id)';
      const projectId = resolveGeminiCliProjectId(account);
      expect(projectId).toBe('project-id');
    });
  });

  describe('buildGeminiCliBuckets', () => {
    it('should group models by series', () => {
      const rawBuckets = [
        { model_id: 'gemini-3-flash-preview', remaining_fraction: 0.8 },
        { model_id: 'gemini-2.5-flash', remaining_fraction: 0.6 },
        { model_id: 'gemini-3-pro-preview', remaining_fraction: 0.9 },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      // Should have 2 groups: Flash Series and Pro Series
      expect(buckets.length).toBeGreaterThanOrEqual(2);

      const flashBucket = buckets.find((b) => b.label === 'Gemini Flash Series');
      expect(flashBucket).toBeDefined();
      // Uses the preferred representative model when it exists
      expect(flashBucket!.remainingFraction).toBe(0.8);
      expect(flashBucket!.remainingPercent).toBe(80);

      const proBucket = buckets.find((b) => b.label === 'Gemini Pro Series');
      expect(proBucket).toBeDefined();
      expect(proBucket!.remainingFraction).toBe(0.9);
    });

    it('should split Flash Lite into its own bucket', () => {
      const rawBuckets = [
        { model_id: 'gemini-2.5-flash-lite', remaining_fraction: 1 },
        { model_id: 'gemini-2.5-flash', remaining_fraction: 0.7 },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      expect(buckets.map((bucket) => bucket.label)).toEqual([
        'Gemini Flash Lite Series',
        'Gemini Flash Series',
      ]);
    });

    it('should recognize Gemini 3.1 preview IDs during the rollout', () => {
      const rawBuckets = [
        { model_id: 'gemini-3.1-flash-preview', remaining_fraction: 0.7 },
        { model_id: 'gemini-3.1-pro-preview', remaining_fraction: 0.4 },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      const flashBucket = buckets.find((b) => b.label === 'Gemini Flash Series');
      const proBucket = buckets.find((b) => b.label === 'Gemini Pro Series');

      expect(flashBucket).toBeDefined();
      expect(flashBucket!.modelIds).toContain('gemini-3.1-flash-preview');
      expect(proBucket).toBeDefined();
      expect(proBucket!.modelIds).toContain('gemini-3.1-pro-preview');
    });

    it('should handle camelCase API response', () => {
      const rawBuckets = [{ modelId: 'gemini-3-flash-preview', remainingFraction: 0.75 }];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      expect(buckets).toHaveLength(1);
      expect(buckets[0].remainingFraction).toBe(0.75);
    });

    it('should clamp remainingFraction to 0-1 range', () => {
      const rawBuckets = [
        { model_id: 'gemini-3-flash-preview', remaining_fraction: 1.5 },
        { model_id: 'gemini-3-pro-preview', remaining_fraction: -0.2 },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      const flashBucket = buckets.find((b) => b.label === 'Gemini Flash Series');
      expect(flashBucket!.remainingFraction).toBe(1);
      expect(flashBucket!.remainingPercent).toBe(100);

      const proBucket = buckets.find((b) => b.label === 'Gemini Pro Series');
      expect(proBucket!.remainingFraction).toBe(0);
      expect(proBucket!.remainingPercent).toBe(0);
    });

    it('should group by token type', () => {
      const rawBuckets = [
        { model_id: 'gemini-3-flash-preview', token_type: 'input', remaining_fraction: 0.8 },
        { model_id: 'gemini-3-flash-preview', token_type: 'output', remaining_fraction: 0.5 },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      // Should have separate buckets for input and output
      expect(buckets.length).toBe(2);
      const inputBucket = buckets.find((b) => b.tokenType === 'input');
      const outputBucket = buckets.find((b) => b.tokenType === 'output');
      expect(inputBucket).toBeDefined();
      expect(outputBucket).toBeDefined();
      expect(inputBucket!.remainingFraction).toBe(0.8);
      expect(outputBucket!.remainingFraction).toBe(0.5);
    });

    it('should ignore deprecated models', () => {
      const rawBuckets = [
        { model_id: 'gemini-2.0-flash-deprecated', remaining_fraction: 0.1 },
        { model_id: 'gemini-3-flash-preview', remaining_fraction: 0.9 },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      // Only gemini-3-flash-preview should be included
      expect(buckets).toHaveLength(1);
      expect(buckets[0].remainingFraction).toBe(0.9);
    });

    it('should preserve unknown model IDs instead of collapsing them', () => {
      const rawBuckets = [{ model_id: 'unknown-model-xyz', remaining_fraction: 0.7 }];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      expect(buckets).toHaveLength(1);
      expect(buckets[0].label).toBe('unknown-model-xyz');
    });

    it('should handle empty buckets array', () => {
      const buckets = buildGeminiCliBuckets([]);
      expect(buckets).toHaveLength(0);
    });

    it('should skip buckets with empty model_id', () => {
      const rawBuckets = [
        { model_id: '', remaining_fraction: 0.5 },
        { model_id: 'gemini-3-flash-preview', remaining_fraction: 0.8 },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      expect(buckets).toHaveLength(1);
      expect(buckets[0].remainingFraction).toBe(0.8);
    });

    it('should keep the representative model reset time when it exists', () => {
      const rawBuckets = [
        {
          model_id: 'gemini-3-flash-preview',
          remaining_fraction: 0.8,
          reset_time: '2026-01-30T12:00:00Z',
        },
        {
          model_id: 'gemini-2.5-flash',
          remaining_fraction: 0.6,
          reset_time: '2026-01-30T10:00:00Z', // Earlier
        },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      const flashBucket = buckets.find((b) => b.label === 'Gemini Flash Series');
      expect(flashBucket!.resetTime).toBe('2026-01-30T12:00:00Z');
    });

    it('should keep earliest reset time when the representative model is missing', () => {
      const rawBuckets = [
        {
          model_id: 'gemini-3.1-flash-preview',
          remaining_fraction: 0.8,
          reset_time: '2026-01-30T12:00:00Z',
        },
        {
          model_id: 'gemini-2.5-flash',
          remaining_fraction: 0.6,
          reset_time: '2026-01-30T10:00:00Z',
        },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      const flashBucket = buckets.find((b) => b.label === 'Gemini Flash Series');
      expect(flashBucket!.resetTime).toBe('2026-01-30T10:00:00Z');
    });

    it('should default remainingFraction to 1 when missing', () => {
      const rawBuckets = [{ model_id: 'gemini-3-flash-preview' }];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      expect(buckets[0].remainingFraction).toBe(1);
      expect(buckets[0].remainingPercent).toBe(100);
    });

    it('should collect modelIds in bucket', () => {
      const rawBuckets = [
        { model_id: 'gemini-3-flash-preview', remaining_fraction: 0.8 },
        { model_id: 'gemini-2.5-flash', remaining_fraction: 0.6 },
      ];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      const flashBucket = buckets.find((b) => b.label === 'Gemini Flash Series');
      expect(flashBucket!.modelIds).toContain('gemini-3-flash-preview');
      expect(flashBucket!.modelIds).toContain('gemini-2.5-flash');
    });
  });

  describe('fetchGeminiCliQuota success metadata', () => {
    it('merges tier and credit metadata into successful quota responses', async () => {
      writeActiveGeminiAccount('success@example.com');

      mockFetch([
        {
          url: GEMINI_QUOTA_URL,
          method: 'POST',
          status: 200,
          response: {
            buckets: [
              {
                model_id: 'gemini-2.5-flash-lite',
                remaining_fraction: 1,
                remaining_amount: 100,
                reset_time: '2026-01-30T09:00:00Z',
              },
              {
                model_id: 'gemini-3-flash-preview',
                remaining_fraction: 0.82,
                remaining_amount: 82,
                reset_time: '2026-01-30T14:00:00Z',
              },
              {
                model_id: 'gemini-2.5-flash',
                remaining_fraction: 0.4,
                remaining_amount: 40,
                reset_time: '2026-01-30T10:00:00Z',
              },
              {
                model_id: 'gemini-3.1-pro-preview',
                remaining_fraction: 0.91,
                remaining_amount: 91,
                reset_time: '2026-01-30T15:00:00Z',
              },
            ],
          },
        },
        {
          url: GEMINI_CODE_ASSIST_URL,
          method: 'POST',
          status: 200,
          response: {
            paidTier: {
              id: 'g1-pro-tier',
              availableCredits: [{ creditType: 'GOOGLE_ONE_AI', creditAmount: 12 }],
            },
          },
        },
      ]);

      const result = await fetchGeminiCliQuota('success@example.com');

      expect(result.success).toBe(true);
      expect(result.tierLabel).toBe('Pro');
      expect(result.tierId).toBe('g1-pro-tier');
      expect(result.creditBalance).toBe(12);
      expect(result.buckets.map((bucket) => bucket.label)).toEqual([
        'Gemini Flash Lite Series',
        'Gemini Flash Series',
        'Gemini Pro Series',
      ]);
      expect(result.buckets[0].remainingAmount).toBe(100);

      const flashBucket = result.buckets.find((bucket) => bucket.label === 'Gemini Flash Series');
      expect(flashBucket?.remainingPercent).toBe(82);
      expect(flashBucket?.remainingAmount).toBe(82);
      expect(flashBucket?.resetTime).toBe('2026-01-30T14:00:00Z');

      const requestUrls = getCapturedFetchRequests().map((request) => request.url);
      expect(requestUrls).toContain(GEMINI_QUOTA_URL);
      expect(requestUrls).toContain(GEMINI_CODE_ASSIST_URL);
    });

    it('keeps base quota success when supplementary metadata fails', async () => {
      writeActiveGeminiAccount('supplementary-failure@example.com');

      mockFetch([
        {
          url: GEMINI_QUOTA_URL,
          method: 'POST',
          status: 200,
          response: {
            buckets: [{ model_id: 'gemini-3-flash-preview', remaining_fraction: 0.75 }],
          },
        },
        {
          url: GEMINI_CODE_ASSIST_URL,
          method: 'POST',
          status: 503,
          response: { error: { message: 'Service unavailable' } },
        },
      ]);

      const result = await fetchGeminiCliQuota('supplementary-failure@example.com');

      expect(result.success).toBe(true);
      expect(result.tierLabel).toBeNull();
      expect(result.tierId).toBeNull();
      expect(result.creditBalance).toBeNull();
      expect(result.buckets[0].remainingPercent).toBe(75);
    });

    it('keeps base quota success when supplementary metadata throws a network error', async () => {
      writeActiveGeminiAccount('supplementary-network@example.com');

      mockFetch([
        {
          url: GEMINI_QUOTA_URL,
          method: 'POST',
          status: 200,
          response: {
            buckets: [{ model_id: 'gemini-3-flash-preview', remaining_fraction: 0.75 }],
          },
        },
      ]);

      const mockedFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === GEMINI_CODE_ASSIST_URL) {
          throw new TypeError('supplementary network down');
        }
        return mockedFetch(input, init);
      }) as typeof fetch;

      try {
        const result = await fetchGeminiCliQuota('supplementary-network@example.com');

        expect(result.success).toBe(true);
        expect(result.tierLabel).toBeNull();
        expect(result.tierId).toBeNull();
        expect(result.creditBalance).toBeNull();
        expect(result.buckets[0].remainingPercent).toBe(75);
      } finally {
        globalThis.fetch = mockedFetch;
      }
    });
  });

  describe('fetchGeminiCliQuota failure metadata', () => {
    it('maps 401 responses to reauth-required metadata', async () => {
      writeActiveGeminiAccount('reauth@example.com');

      mockFetch([
        {
          url: GEMINI_QUOTA_URL,
          method: 'POST',
          status: 401,
          response: {
            error: {
              message: 'Session expired',
              status: 'UNAUTHENTICATED',
            },
          },
        },
        {
          url: GOOGLE_TOKEN_URL,
          method: 'POST',
          status: 400,
          response: {
            error: 'invalid_grant',
          },
        },
      ]);

      const result = await fetchGeminiCliQuota('reauth@example.com');

      expect(result.success).toBe(false);
      expect(result.httpStatus).toBe(401);
      expect(result.errorCode).toBe('UNAUTHENTICATED');
      expect(result.needsReauth).toBe(true);
      expect(result.retryable).toBe(false);
      expect(result.actionHint).toContain('ccs gemini --auth');
      expect(result.error).toBe('Session expired');
    });

    it('preserves 403 verification detail and exposes a helpful action hint', async () => {
      writeActiveGeminiAccount('verify@example.com');

      mockFetch([
        {
          url: GEMINI_QUOTA_URL,
          method: 'POST',
          status: 403,
          response: {
            error: {
              message: 'Google requires you to verify this account before using Gemini CLI quota.',
              status: 'PERMISSION_DENIED',
              details: [
                {
                  reason: 'ACCOUNT_VERIFICATION_REQUIRED',
                },
              ],
            },
          },
        },
      ]);

      const result = await fetchGeminiCliQuota('verify@example.com');

      expect(result.success).toBe(false);
      expect(result.httpStatus).toBe(403);
      expect(result.isForbidden).toBe(true);
      expect(result.retryable).toBe(false);
      expect(result.error).toContain('verify this account');
      expect(result.actionHint).toContain('verification');
      expect(result.errorDetail).toContain('ACCOUNT_VERIFICATION_REQUIRED');
    });

    it('marks 429 responses as retryable', async () => {
      writeActiveGeminiAccount('rate-limit@example.com');

      mockFetch([
        {
          url: GEMINI_QUOTA_URL,
          method: 'POST',
          status: 429,
          response: {
            error: {
              message: 'Too many quota requests',
              status: 'RESOURCE_EXHAUSTED',
            },
          },
        },
      ]);

      const result = await fetchGeminiCliQuota('rate-limit@example.com');

      expect(result.success).toBe(false);
      expect(result.httpStatus).toBe(429);
      expect(result.retryable).toBe(true);
      expect(result.errorCode).toBe('RESOURCE_EXHAUSTED');
      expect(result.actionHint).toContain('Retry');
      expect(result.error).toBe('Too many quota requests');
    });

    it('preserves non-JSON upstream error text when Gemini returns a plain-text failure', async () => {
      writeActiveGeminiAccount('plaintext@example.com');

      mockFetch([
        {
          url: GEMINI_QUOTA_URL,
          method: 'POST',
          status: 418,
          headers: { 'Content-Type': 'text/plain' },
          response: 'Internal Server Error',
        },
      ]);

      const result = await fetchGeminiCliQuota('plaintext@example.com');

      expect(result.success).toBe(false);
      expect(result.httpStatus).toBe(418);
      expect(result.errorCode).toBe('quota_request_failed');
      expect(result.retryable).toBe(false);
      expect(result.error).toBe('Internal Server Error');
      expect(result.errorDetail).toBe('Internal Server Error');
    });

    it('marks 5xx Gemini quota responses as retryable provider outages', async () => {
      writeActiveGeminiAccount('outage@example.com');

      mockFetch([
        {
          url: GEMINI_QUOTA_URL,
          method: 'POST',
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
          response: 'Service temporarily unavailable',
        },
      ]);

      const result = await fetchGeminiCliQuota('outage@example.com');

      expect(result.success).toBe(false);
      expect(result.httpStatus).toBe(503);
      expect(result.errorCode).toBe('provider_unavailable');
      expect(result.retryable).toBe(true);
      expect(result.actionHint).toContain('temporary Google upstream problem');
      expect(result.error).toBe('Service temporarily unavailable');
    });

    it('omits raw HTML upstream bodies from Gemini quota error detail', async () => {
      writeActiveGeminiAccount('html@example.com');

      mockFetch([
        {
          url: GEMINI_QUOTA_URL,
          method: 'POST',
          status: 502,
          headers: { 'Content-Type': 'text/html' },
          response: '<!doctype html><html><body>bad gateway</body></html>',
        },
      ]);

      const result = await fetchGeminiCliQuota('html@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Gemini quota service unavailable (HTTP 502)');
      expect(result.errorDetail).toBe('[HTML error response omitted]');
    });
  });

  describe('direct Gemini error helper coverage', () => {
    it('sanitizes HTML and truncates oversized token-bearing error details', () => {
      const longTokenBody = JSON.stringify({
        access_token: 'super-secret-token',
        detail: `Bearer top-secret ${'x'.repeat(400)}`,
      });

      const sanitized = geminiTestExports.sanitizeGeminiCliErrorDetail(longTokenBody);

      expect(sanitized).toContain('[redacted]');
      expect(sanitized).toContain('Bearer [redacted]');
      expect(sanitized?.endsWith('...[truncated]')).toBe(true);
      expect(sanitized?.length).toBeLessThanOrEqual(320);
      expect(geminiTestExports.sanitizeGeminiCliErrorDetail('<html>bad gateway</html>')).toBe(
        '[HTML error response omitted]'
      );
    });

    it('extracts nested messages and parses structured JSON error bodies', () => {
      expect(
        geminiTestExports.extractGeminiCliNestedMessage([
          { reason: 'ACCOUNT_VERIFICATION_REQUIRED' },
        ])
      ).toBe('ACCOUNT_VERIFICATION_REQUIRED');

      const parsed = geminiTestExports.parseGeminiCliErrorBody(
        JSON.stringify({
          error: {
            message: 'Verification required',
            status: 'PERMISSION_DENIED',
            details: [{ reason: 'ACCOUNT_VERIFICATION_REQUIRED' }],
          },
        })
      );

      expect(parsed.message).toBe('Verification required');
      expect(parsed.errorCode).toBe('PERMISSION_DENIED');
      expect(parsed.errorDetail).toContain('ACCOUNT_VERIFICATION_REQUIRED');
    });

    it('builds verification and project-specific forbidden action hints', () => {
      expect(
        geminiTestExports.buildGeminiCliForbiddenActionHint({
          message: 'Please verify this account',
          errorDetail: 'ACCOUNT_VERIFICATION_REQUIRED',
        })
      ).toContain('verification');

      expect(
        geminiTestExports.buildGeminiCliForbiddenActionHint({
          message: 'Project no longer has access',
        })
      ).toContain('project');
    });
  });

  describe('refreshGeminiToken', () => {
    it('uses OAuth client metadata stored in the token file', async () => {
      writeGeminiToken({
        type: 'gemini',
        email: 'file@example.com',
        token: {
          access_token: 'old-token',
          refresh_token: 'refresh-from-file',
          expiry: Date.now() - 1000,
          client_id: 'file-client-id',
          client_secret: 'file-client-secret',
          token_uri: 'https://oauth2.googleapis.com/token',
        },
      });

      mockFetch([
        {
          url: 'https://oauth2.googleapis.com/token',
          method: 'POST',
          response: { access_token: 'fresh-token', expires_in: 1800 },
        },
      ]);

      const result = await refreshGeminiToken();

      expect(result.success).toBe(true);
      const [request] = getCapturedFetchRequests();
      expect(request.body).toContain('client_id=file-client-id');
      expect(request.body).toContain('client_secret=file-client-secret');
      expect(request.body).toContain('refresh_token=refresh-from-file');
    });

    it('falls back to CCS_GEMINI_OAUTH_CLIENT_* env vars when token metadata is missing', async () => {
      process.env.CCS_GEMINI_OAUTH_CLIENT_ID = 'env-client-id';
      process.env.CCS_GEMINI_OAUTH_CLIENT_SECRET = 'env-client-secret';

      writeGeminiToken({
        type: 'gemini',
        email: 'env@example.com',
        token: {
          access_token: 'old-token',
          refresh_token: 'refresh-from-file',
          expiry: Date.now() - 1000,
        },
      });

      mockFetch([
        {
          url: 'https://oauth2.googleapis.com/token',
          method: 'POST',
          response: { access_token: 'fresh-token', expires_in: 1800 },
        },
      ]);

      const result = await refreshGeminiToken();

      expect(result.success).toBe(true);
      const [request] = getCapturedFetchRequests();
      expect(request.body).toContain('client_id=env-client-id');
      expect(request.body).toContain('client_secret=env-client-secret');
    });

    it('returns a clear error when no refresh client credentials are available', async () => {
      writeGeminiToken({
        type: 'gemini',
        email: 'missing@example.com',
        token: {
          access_token: 'old-token',
          refresh_token: 'refresh-from-file',
          expiry: Date.now() - 1000,
        },
      });

      const result = await refreshGeminiToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('CCS_GEMINI_OAUTH_CLIENT_ID');
      expect(result.error).toContain('CCS_GEMINI_OAUTH_CLIENT_SECRET');
    });
  });
});
