/**
 * Account Safety Quota Exhaustion Handler Tests
 *
 * Tests for handleQuotaExhaustion() and writeQuotaWarning():
 * - Cooldown application
 * - Account switching
 * - Fallback when no alternatives
 * - Warning output formatting
 * - Email masking
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  handleQuotaExhaustion,
  writeQuotaWarning,
  maskEmail,
} from '../../../src/cliproxy/account-safety';
import { sanitizeEmail } from '../../../src/cliproxy/auth-utils';

// Setup test isolation
let tmpDir: string;
let origCcsHome: string | undefined;
let originalFetch: typeof fetch;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-test-exhaust-'));
  origCcsHome = process.env.CCS_HOME;
  process.env.CCS_HOME = tmpDir;
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  if (origCcsHome !== undefined) {
    process.env.CCS_HOME = origCcsHome;
  } else {
    delete process.env.CCS_HOME;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: write accounts registry
function writeRegistry(providers: Record<string, unknown>): void {
  const registryDir = path.join(tmpDir, '.ccs', 'cliproxy');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'accounts.json'),
    JSON.stringify({ version: 1, providers }, null, 2)
  );
}

// Helper: write unified config
function writeConfig(quotaConfig: unknown): void {
  const configDir = path.join(tmpDir, '.ccs', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'unified-config.json'),
    JSON.stringify({
      version: 2,
      quota_management: quotaConfig,
    })
  );
}

function writeClaudeAuth(accountId: string, accessToken: string): void {
  const authDir = path.join(tmpDir, '.ccs', 'cliproxy', 'auth');
  const tokenFile = `claude-${sanitizeEmail(accountId)}.json`;
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(
    path.join(authDir, tokenFile),
    JSON.stringify(
      {
        access_token: accessToken,
        expired: '2099-01-01T00:00:00.000Z',
        type: 'claude',
        email: accountId,
      },
      null,
      2
    )
  );
}

describe('Quota Exhaustion Handlers', () => {
  describe('writeQuotaWarning', () => {
    it('should write to stderr with box format', async () => {
      const stderrWrites: string[] = [];
      const originalWrite = process.stderr.write;
      process.stderr.write = ((chunk: string) => {
        stderrWrites.push(chunk);
        return true;
      }) as any;

      writeQuotaWarning('test@gmail.com', 20);

      process.stderr.write = originalWrite;

      // Verify output contains account
      const fullOutput = stderrWrites.join('');
      expect(fullOutput).toContain('tes');
      expect(fullOutput).toContain('20%');

      // Verify box borders present
      expect(fullOutput).toContain('\u2554'); // Top-left corner
      expect(fullOutput).toContain('\u2557'); // Top-right corner
      expect(fullOutput).toContain('\u255A'); // Bottom-left corner
      expect(fullOutput).toContain('\u255D'); // Bottom-right corner
      expect(fullOutput).toContain('\u2551'); // Vertical bar
    });

    it('should mask email showing only first 3 chars', async () => {
      const stderrWrites: string[] = [];
      const originalWrite = process.stderr.write;
      process.stderr.write = ((chunk: string) => {
        stderrWrites.push(chunk);
        return true;
      }) as any;

      writeQuotaWarning('verylongemail@example.com', 15);

      process.stderr.write = originalWrite;

      const fullOutput = stderrWrites.join('');
      // Should show "ver***@example.com"
      expect(fullOutput).toContain('ver***@example.com');
      expect(fullOutput).not.toContain('verylongemail@example.com');
    });

    it('should include threshold percentage', async () => {
      const stderrWrites: string[] = [];
      const originalWrite = process.stderr.write;
      process.stderr.write = ((chunk: string) => {
        stderrWrites.push(chunk);
        return true;
      }) as any;

      writeQuotaWarning('test@gmail.com', 5);

      process.stderr.write = originalWrite;

      const fullOutput = stderrWrites.join('');
      expect(fullOutput).toContain('5%');
    });
  });

  describe('maskEmail', () => {
    it('should mask standard email', () => {
      const result = maskEmail('user@example.com');
      expect(result).toBe('use***@example.com');
    });

    it('should handle short local part', () => {
      const result = maskEmail('ab@example.com');
      expect(result).toBe('ab***@example.com');
    });

    it('should handle single char local part', () => {
      const result = maskEmail('a@example.com');
      expect(result).toBe('a***@example.com');
    });

    it('should return input if no @ sign', () => {
      const result = maskEmail('not-an-email');
      expect(result).toBe('not-an-email');
    });

    it('should return input if empty string', () => {
      const result = maskEmail('');
      expect(result).toBe('');
    });
  });

  describe('handleQuotaExhaustion', () => {
    it('should apply cooldown to exhausted account', async () => {
      writeRegistry({
        agy: {
          default: 'exhausted@gmail.com',
          accounts: {
            'exhausted@gmail.com': {
              email: 'exhausted@gmail.com',
              tokenFile: 'agy-exhausted.json',
            },
          },
        },
      });

      writeConfig({
        mode: 'auto',
        auto: {
          tier_priority: ['ultra', 'pro'],
          exhaustion_threshold: 5,
          cooldown_minutes: 10,
          preflight_check: true,
        },
        runtime_monitor: {
          enabled: true,
          normal_interval_seconds: 300,
          critical_interval_seconds: 60,
          warn_threshold: 20,
          exhaustion_threshold: 5,
          cooldown_minutes: 10,
        },
      });

      const { isOnCooldown } = await import('../../../src/cliproxy/quota-manager');

      const result = await handleQuotaExhaustion('agy', 'exhausted@gmail.com', 10);

      // Verify cooldown was applied (account now on cooldown)
      expect(isOnCooldown('agy', 'exhausted@gmail.com')).toBe(true);
      // Should return a result with reason
      expect(result.reason).toBeDefined();
    });

    it('should handle no alternatives gracefully', async () => {
      writeRegistry({
        agy: {
          default: 'only@gmail.com',
          accounts: {
            'only@gmail.com': {
              email: 'only@gmail.com',
              tokenFile: 'agy-only.json',
            },
          },
        },
      });

      writeConfig({
        mode: 'auto',
        auto: {
          tier_priority: ['ultra', 'pro'],
          exhaustion_threshold: 5,
          cooldown_minutes: 10,
          preflight_check: true,
        },
        runtime_monitor: {
          enabled: true,
          normal_interval_seconds: 300,
          critical_interval_seconds: 60,
          warn_threshold: 20,
          exhaustion_threshold: 5,
          cooldown_minutes: 10,
        },
      });

      const result = await handleQuotaExhaustion('agy', 'only@gmail.com', 10);

      // Should return gracefully with null switched
      expect(result.switchedTo).toBeNull();
      expect(result.reason).toContain('no alternatives');
    });

    it('should switch Claude accounts when fallback quota is unavailable but auth is valid', async () => {
      writeRegistry({
        claude: {
          default: 'exhausted@example.com',
          accounts: {
            'exhausted@example.com': {
              email: 'exhausted@example.com',
              tokenFile: `claude-${sanitizeEmail('exhausted@example.com')}.json`,
            },
            'fallback@example.com': {
              email: 'fallback@example.com',
              tokenFile: `claude-${sanitizeEmail('fallback@example.com')}.json`,
            },
          },
        },
      });

      writeConfig({
        mode: 'auto',
        auto: {
          tier_priority: ['ultra', 'pro', 'free'],
          exhaustion_threshold: 5,
          cooldown_minutes: 10,
          preflight_check: true,
        },
        runtime_monitor: {
          enabled: true,
          normal_interval_seconds: 300,
          critical_interval_seconds: 60,
          warn_threshold: 20,
          exhaustion_threshold: 5,
          cooldown_minutes: 10,
        },
      });

      writeClaudeAuth('exhausted@example.com', 'exhausted-token');
      writeClaudeAuth('fallback@example.com', 'fallback-token');

      global.fetch = mock((_url: string, options?: RequestInit) => {
        const authHeader = new Headers(options?.headers).get('Authorization') ?? '';
        if (authHeader === 'Bearer fallback-token') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  message: 'OAuth authentication is currently not supported.',
                },
              }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }

        return Promise.resolve(new Response('', { status: 500 }));
      }) as typeof fetch;

      const result = await handleQuotaExhaustion('claude', 'exhausted@example.com', 10);
      const { getDefaultAccount } = await import('../../../src/cliproxy/account-manager');

      expect(result.switchedTo).toBe('fallback@example.com');
      expect(getDefaultAccount('claude')?.id).toBe('fallback@example.com');
    });

    it('should write warning to stderr', async () => {
      writeRegistry({
        agy: {
          default: 'exhausted@gmail.com',
          accounts: {
            'exhausted@gmail.com': {
              email: 'exhausted@gmail.com',
              tokenFile: 'agy-exhausted.json',
            },
          },
        },
      });

      writeConfig({
        mode: 'auto',
        auto: {
          tier_priority: ['ultra', 'pro'],
          exhaustion_threshold: 5,
          cooldown_minutes: 10,
          preflight_check: true,
        },
        runtime_monitor: {
          enabled: true,
          normal_interval_seconds: 300,
          critical_interval_seconds: 60,
          warn_threshold: 20,
          exhaustion_threshold: 5,
          cooldown_minutes: 10,
        },
      });

      const stderrWrites: string[] = [];
      const originalWrite = process.stderr.write;
      process.stderr.write = ((chunk: string) => {
        stderrWrites.push(chunk);
        return true;
      }) as any;

      await handleQuotaExhaustion('agy', 'exhausted@gmail.com', 10);

      process.stderr.write = originalWrite;

      const fullOutput = stderrWrites.join('');
      // Should contain exhaustion indicator
      expect(fullOutput).toContain('[X]');
    });

    it('should complete without throwing', async () => {
      writeRegistry({
        agy: {
          default: 'test@gmail.com',
          accounts: {
            'test@gmail.com': {
              email: 'test@gmail.com',
              tokenFile: 'agy-test.json',
            },
          },
        },
      });

      writeConfig({
        mode: 'auto',
        auto: {
          tier_priority: ['ultra', 'pro'],
          exhaustion_threshold: 5,
          cooldown_minutes: 5,
          preflight_check: true,
        },
        runtime_monitor: {
          enabled: true,
          normal_interval_seconds: 300,
          critical_interval_seconds: 60,
          warn_threshold: 20,
          exhaustion_threshold: 5,
          cooldown_minutes: 5,
        },
      });

      const result = await handleQuotaExhaustion('agy', 'test@gmail.com', 5);
      expect(result).toBeDefined();
      expect(result.switchedTo).toBeNull();
    });
  });
});
