/**
 * Shadow Auth Builder Tests
 *
 * Tests for shadow auth directory creation with base_url injection
 * for Pro-tier Antigravity accounts in the model tier transformer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createTransformerShadowAuthDir,
  cleanupTransformerShadowAuthDir,
} from '../../../src/cliproxy/shadow-auth-builder';

const FALLBACK_MAP = { 'claude-opus-4-6-thinking': 'claude-opus-4-5-thinking' };
const TRANSFORMER_PORT = 54321;

/** Setup a temp CCS_HOME with auth files and accounts registry */
function setupTestEnv(opts: {
  accounts: Record<string, { tokenFile: string; tier?: string; paused?: boolean }>;
  authFiles: Record<string, Record<string, unknown>>;
}): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-shadow-test-'));
  const authDir = path.join(tmpDir, '.ccs', 'cliproxy', 'auth');
  fs.mkdirSync(authDir, { recursive: true });

  // Write auth files
  for (const [filename, content] of Object.entries(opts.authFiles)) {
    fs.writeFileSync(path.join(authDir, filename), JSON.stringify(content, null, 2));
  }

  // Write accounts registry
  const registryPath = path.join(tmpDir, '.ccs', 'cliproxy', 'accounts.json');
  const registry = {
    version: 1,
    providers: {
      agy: {
        default: Object.keys(opts.accounts)[0] ?? '',
        accounts: opts.accounts,
      },
    },
  };
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));

  return tmpDir;
}

describe('shadow-auth-builder', () => {
  let originalCcsHome: string | undefined;
  let tmpDir: string | null = null;

  beforeEach(() => {
    originalCcsHome = process.env.CCS_HOME;
  });

  afterEach(() => {
    // Restore CCS_HOME
    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }

    // Clean up temp dir
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  describe('createTransformerShadowAuthDir', () => {
    it('should return shadow dir path when mixed tiers exist', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra-account': { tokenFile: 'ultra.json', tier: 'ultra' },
          'pro-account': { tokenFile: 'pro.json', tier: 'pro' },
        },
        authFiles: {
          'ultra.json': { type: 'antigravity', token: 'ultra-token' },
          'pro.json': { type: 'antigravity', token: 'pro-token' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      const result = createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP);
      expect(result).not.toBeNull();
      expect(result).toContain('auth-transformer');
      expect(fs.existsSync(result!)).toBe(true);
    });

    it('should return null when all accounts are ultra', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra1': { tokenFile: 'u1.json', tier: 'ultra' },
          'ultra2': { tokenFile: 'u2.json', tier: 'ultra' },
        },
        authFiles: {
          'u1.json': { type: 'antigravity', token: 't1' },
          'u2.json': { type: 'antigravity', token: 't2' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      expect(createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP)).toBeNull();
    });

    it('should return null when all accounts are pro', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'pro1': { tokenFile: 'p1.json', tier: 'pro' },
          'pro2': { tokenFile: 'p2.json', tier: 'pro' },
        },
        authFiles: {
          'p1.json': { type: 'antigravity', token: 't1' },
          'p2.json': { type: 'antigravity', token: 't2' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      expect(createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP)).toBeNull();
    });

    it('should return null when fallback map is empty', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra': { tokenFile: 'u.json', tier: 'ultra' },
          'pro': { tokenFile: 'p.json', tier: 'pro' },
        },
        authFiles: {
          'u.json': { type: 'antigravity', token: 't1' },
          'p.json': { type: 'antigravity', token: 't2' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      expect(createTransformerShadowAuthDir(TRANSFORMER_PORT, {})).toBeNull();
    });

    it('should inject base_url for pro accounts only', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra-acc': { tokenFile: 'ultra.json', tier: 'ultra' },
          'pro-acc': { tokenFile: 'pro.json', tier: 'pro' },
        },
        authFiles: {
          'ultra.json': { type: 'antigravity', token: 'ultra-token' },
          'pro.json': { type: 'antigravity', token: 'pro-token' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      const shadowDir = createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP);
      expect(shadowDir).not.toBeNull();

      // Pro file should have base_url injected
      const proContent = JSON.parse(fs.readFileSync(path.join(shadowDir!, 'pro.json'), 'utf-8'));
      expect(proContent.base_url).toBe(`http://127.0.0.1:${TRANSFORMER_PORT}`);
      expect(proContent.token).toBe('pro-token');

      // Ultra file should NOT have base_url
      const ultraContent = JSON.parse(fs.readFileSync(path.join(shadowDir!, 'ultra.json'), 'utf-8'));
      expect(ultraContent.base_url).toBeUndefined();
      expect(ultraContent.token).toBe('ultra-token');
    });

    it('should treat unknown tier as lower tier (gets base_url)', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra-acc': { tokenFile: 'ultra.json', tier: 'ultra' },
          'unknown-acc': { tokenFile: 'unknown.json', tier: 'unknown' },
        },
        authFiles: {
          'ultra.json': { type: 'antigravity', token: 'ultra-token' },
          'unknown.json': { type: 'antigravity', token: 'unknown-token' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      const shadowDir = createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP);
      expect(shadowDir).not.toBeNull();

      const unknownContent = JSON.parse(fs.readFileSync(path.join(shadowDir!, 'unknown.json'), 'utf-8'));
      expect(unknownContent.base_url).toBe(`http://127.0.0.1:${TRANSFORMER_PORT}`);
    });

    it('should treat missing tier as unknown (lower tier)', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra-acc': { tokenFile: 'ultra.json', tier: 'ultra' },
          'no-tier-acc': { tokenFile: 'notier.json' },
        },
        authFiles: {
          'ultra.json': { type: 'antigravity', token: 'ultra-token' },
          'notier.json': { type: 'antigravity', token: 'notier-token' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      const shadowDir = createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP);
      expect(shadowDir).not.toBeNull();

      const content = JSON.parse(fs.readFileSync(path.join(shadowDir!, 'notier.json'), 'utf-8'));
      expect(content.base_url).toBe(`http://127.0.0.1:${TRANSFORMER_PORT}`);
    });

    it('should skip paused accounts when checking mixed tiers', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra-acc': { tokenFile: 'ultra.json', tier: 'ultra' },
          'pro-acc': { tokenFile: 'pro.json', tier: 'pro', paused: true },
        },
        authFiles: {
          'ultra.json': { type: 'antigravity', token: 't1' },
          'pro.json': { type: 'antigravity', token: 't2' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      // Only ultra is active, so no mixed tiers
      expect(createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP)).toBeNull();
    });

    it('should copy non-antigravity auth files unchanged', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra-acc': { tokenFile: 'ultra.json', tier: 'ultra' },
          'pro-acc': { tokenFile: 'pro.json', tier: 'pro' },
        },
        authFiles: {
          'ultra.json': { type: 'antigravity', token: 'ultra-token' },
          'pro.json': { type: 'antigravity', token: 'pro-token' },
          'other.json': { type: 'codex', token: 'codex-token' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      const shadowDir = createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP);
      expect(shadowDir).not.toBeNull();

      // Non-antigravity file should be copied unchanged
      const otherContent = JSON.parse(fs.readFileSync(path.join(shadowDir!, 'other.json'), 'utf-8'));
      expect(otherContent.type).toBe('codex');
      expect(otherContent.base_url).toBeUndefined();
    });

    it('should create shadow dir with 0o700 permissions', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra-acc': { tokenFile: 'ultra.json', tier: 'ultra' },
          'pro-acc': { tokenFile: 'pro.json', tier: 'pro' },
        },
        authFiles: {
          'ultra.json': { type: 'antigravity', token: 't1' },
          'pro.json': { type: 'antigravity', token: 't2' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      const shadowDir = createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP);
      expect(shadowDir).not.toBeNull();

      const stat = fs.statSync(shadowDir!);
      expect(stat.mode & 0o777).toBe(0o700);
    });

    it('should write auth files with 0o600 permissions', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra-acc': { tokenFile: 'ultra.json', tier: 'ultra' },
          'pro-acc': { tokenFile: 'pro.json', tier: 'pro' },
        },
        authFiles: {
          'ultra.json': { type: 'antigravity', token: 't1' },
          'pro.json': { type: 'antigravity', token: 't2' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      const shadowDir = createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP);
      expect(shadowDir).not.toBeNull();

      const proStat = fs.statSync(path.join(shadowDir!, 'pro.json'));
      expect(proStat.mode & 0o777).toBe(0o600);

      const ultraStat = fs.statSync(path.join(shadowDir!, 'ultra.json'));
      expect(ultraStat.mode & 0o777).toBe(0o600);
    });

    it('should return null when auth dir does not exist', () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-shadow-test-'));
      // No auth dir created
      process.env.CCS_HOME = tmpDir;

      expect(createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP)).toBeNull();
    });

    it('should return null when no agy provider in registry', () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-shadow-test-'));
      const authDir = path.join(tmpDir, '.ccs', 'cliproxy', 'auth');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(path.join(authDir, 'test.json'), '{}');

      // Registry without agy provider
      const registryPath = path.join(tmpDir, '.ccs', 'cliproxy', 'accounts.json');
      fs.writeFileSync(registryPath, JSON.stringify({ version: 1, providers: {} }));

      process.env.CCS_HOME = tmpDir;
      expect(createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP)).toBeNull();
    });

    it('should clean and recreate shadow dir if it already exists', () => {
      tmpDir = setupTestEnv({
        accounts: {
          'ultra-acc': { tokenFile: 'ultra.json', tier: 'ultra' },
          'pro-acc': { tokenFile: 'pro.json', tier: 'pro' },
        },
        authFiles: {
          'ultra.json': { type: 'antigravity', token: 't1' },
          'pro.json': { type: 'antigravity', token: 't2' },
        },
      });
      process.env.CCS_HOME = tmpDir;

      // Pre-create shadow dir with stale file
      const shadowDir = path.join(tmpDir, '.ccs', 'cliproxy', 'auth-transformer');
      fs.mkdirSync(shadowDir, { recursive: true });
      fs.writeFileSync(path.join(shadowDir, 'stale.json'), '{}');

      const result = createTransformerShadowAuthDir(TRANSFORMER_PORT, FALLBACK_MAP);
      expect(result).not.toBeNull();

      // Stale file should be gone
      expect(fs.existsSync(path.join(result!, 'stale.json'))).toBe(false);
      // New files should exist
      expect(fs.existsSync(path.join(result!, 'pro.json'))).toBe(true);
    });
  });

  describe('cleanupTransformerShadowAuthDir', () => {
    it('should remove shadow dir if it exists', () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-shadow-test-'));
      const shadowDir = path.join(tmpDir, '.ccs', 'cliproxy', 'auth-transformer');
      fs.mkdirSync(shadowDir, { recursive: true });
      fs.writeFileSync(path.join(shadowDir, 'test.json'), '{}');

      process.env.CCS_HOME = tmpDir;
      cleanupTransformerShadowAuthDir();

      expect(fs.existsSync(shadowDir)).toBe(false);
    });

    it('should not throw if shadow dir does not exist', () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-shadow-test-'));
      process.env.CCS_HOME = tmpDir;

      expect(() => cleanupTransformerShadowAuthDir()).not.toThrow();
    });
  });
});
