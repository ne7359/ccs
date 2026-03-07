import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  copyApiProfile,
  discoverApiProfileOrphans,
  exportApiProfile,
  importApiProfileBundle,
  registerApiProfileOrphans,
} from '../../../src/api/services/profile-lifecycle-service';

describe('profile lifecycle service', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-profile-lifecycle-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
    }

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('discovers only API profile orphans (skips registered and reserved names)', () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });

    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: { glm: '~/.ccs/glm.settings.json' } }, null, 2) + '\n'
    );

    fs.writeFileSync(
      path.join(ccsDir, 'glm.settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } }, null, 2) +
        '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'extra.settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } }, null, 2) +
        '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'gemini.settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } }, null, 2) +
        '\n'
    );

    const result = discoverApiProfileOrphans();
    expect(result.orphans.map((orphan) => orphan.name)).toEqual(['extra']);
  });

  it('treats explicit empty names list as no-op during orphan registration', () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });

    fs.writeFileSync(
      path.join(ccsDir, 'lonely.settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } }, null, 2) +
        '\n'
    );
    fs.writeFileSync(path.join(ccsDir, 'config.json'), JSON.stringify({ profiles: {} }, null, 2) + '\n');

    const result = registerApiProfileOrphans({ names: [] });
    expect(result.registered).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('redacts all sensitive env values during export when includeSecrets=false', () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });

    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: { glm: '~/.ccs/glm.settings.json' } }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'glm.settings.json'),
      JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.example.com',
            ANTHROPIC_AUTH_TOKEN: 'token-1',
            OPENROUTER_API_KEY: 'token-2',
          },
        },
        null,
        2
      ) + '\n'
    );

    const result = exportApiProfile('glm', false);
    expect(result.success).toBe(true);
    expect(result.bundle?.settings).toBeDefined();

    const env = (result.bundle?.settings.env as Record<string, unknown>) || {};
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('__CCS_REDACTED__');
    expect(env.OPENROUTER_API_KEY).toBe('__CCS_REDACTED__');
  });

  it('rejects invalid source profile names in copy flow', () => {
    const result = copyApiProfile('../escape', 'safe-name');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid source profile name');
  });

  it('rejects import bundle with invalid profile target', () => {
    const result = importApiProfileBundle({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profile: { name: 'glm', target: 'invalid-target' },
      settings: {
        env: {
          ANTHROPIC_BASE_URL: 'https://api.example.com',
          ANTHROPIC_AUTH_TOKEN: 'token',
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid bundle profile target');
  });

  it('clears and warns for all redacted sensitive env keys on import', () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(path.join(ccsDir, 'config.json'), JSON.stringify({ profiles: {} }, null, 2) + '\n');

    const result = importApiProfileBundle({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profile: { name: 'redacted-import', target: 'claude' },
      settings: {
        env: {
          ANTHROPIC_BASE_URL: 'https://api.example.com',
          ANTHROPIC_AUTH_TOKEN: '__CCS_REDACTED__',
          OPENROUTER_API_KEY: '__CCS_REDACTED__',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.warnings?.length).toBeGreaterThan(0);

    const settingsPath = path.join(ccsDir, 'redacted-import.settings.json');
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('');
    expect(parsed.env.OPENROUTER_API_KEY).toBe('');
  });
});
