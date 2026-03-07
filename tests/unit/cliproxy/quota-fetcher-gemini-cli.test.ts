/**
 * Gemini CLI Quota Fetcher Unit Tests
 *
 * Tests for Gemini CLI bucket parsing and transformation logic
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  buildGeminiCliBuckets,
  resolveGeminiCliProjectId,
} from '../../../src/cliproxy/quota-fetcher-gemini-cli';
import { refreshGeminiToken } from '../../../src/cliproxy/auth/gemini-token-refresh';
import { getProviderAuthDir } from '../../../src/cliproxy/config-generator';
import { getCapturedFetchRequests, mockFetch, restoreFetch } from '../../mocks';

describe('Gemini CLI Quota Fetcher', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let originalCcsHome: string | undefined;
  let originalGeminiClientId: string | undefined;
  let originalGeminiClientSecret: string | undefined;

  function writeGeminiToken(token: Record<string, unknown>): string {
    const authDir = getProviderAuthDir('gemini');
    fs.mkdirSync(authDir, { recursive: true });
    const tokenPath = path.join(authDir, 'gemini-test.json');
    fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
    return tokenPath;
  }

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-gemini-refresh-'));
    originalHome = process.env.HOME;
    originalCcsHome = process.env.CCS_HOME;
    originalGeminiClientId = process.env.CCS_GEMINI_OAUTH_CLIENT_ID;
    originalGeminiClientSecret = process.env.CCS_GEMINI_OAUTH_CLIENT_SECRET;

    process.env.HOME = tempHome;
    process.env.CCS_HOME = tempHome;
    delete process.env.CCS_GEMINI_OAUTH_CLIENT_ID;
    delete process.env.CCS_GEMINI_OAUTH_CLIENT_SECRET;
  });

  afterEach(() => {
    restoreFetch();
    fs.rmSync(tempHome, { recursive: true, force: true });

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
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
      // Takes minimum remaining fraction (0.6)
      expect(flashBucket!.remainingFraction).toBe(0.6);
      expect(flashBucket!.remainingPercent).toBe(60);

      const proBucket = buckets.find((b) => b.label === 'Gemini Pro Series');
      expect(proBucket).toBeDefined();
      expect(proBucket!.remainingFraction).toBe(0.9);
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

    it('should categorize unknown models as "other"', () => {
      const rawBuckets = [{ model_id: 'unknown-model-xyz', remaining_fraction: 0.7 }];

      const buckets = buildGeminiCliBuckets(rawBuckets);

      expect(buckets).toHaveLength(1);
      expect(buckets[0].label).toBe('Other Models');
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

    it('should keep earliest reset time when merging', () => {
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
