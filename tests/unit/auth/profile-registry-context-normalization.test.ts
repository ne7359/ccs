import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ProfileRegistry from '../../../src/auth/profile-registry';

describe('profile-registry context normalization', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;
  let originalUnifiedMode: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-profile-registry-context-'));
    originalCcsHome = process.env.CCS_HOME;
    originalUnifiedMode = process.env.CCS_UNIFIED_CONFIG;
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    if (originalCcsHome !== undefined) process.env.CCS_HOME = originalCcsHome;
    else delete process.env.CCS_HOME;

    if (originalUnifiedMode !== undefined) process.env.CCS_UNIFIED_CONFIG = originalUnifiedMode;
    else delete process.env.CCS_UNIFIED_CONFIG;

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('drops non-string legacy context_group values without throwing', () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'profiles.json'),
      JSON.stringify(
        {
          version: '2.0.0',
          default: null,
          profiles: {
            work: {
              type: 'account',
              created: '2026-02-24T00:00:00.000Z',
              last_used: null,
              context_mode: 'shared',
              context_group: { invalid: true },
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const registry = new ProfileRegistry();
    const profile = registry.getProfile('work');

    expect(profile.context_mode).toBe('shared');
    expect(profile.context_group).toBeUndefined();
    expect(profile.continuity_mode).toBe('standard');
  });

  it('drops non-string unified context_group values without throwing', () => {
    process.env.CCS_UNIFIED_CONFIG = '1';
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.yaml'),
      [
        'version: 8',
        'accounts:',
        '  work:',
        '    created: "2026-02-24T00:00:00.000Z"',
        '    last_used: null',
        '    context_mode: shared',
        '    context_group: 123',
        'profiles: {}',
        'cliproxy:',
        '  oauth_accounts: {}',
        '  providers: {}',
        '  variants: {}',
      ].join('\n'),
      'utf8'
    );

    const registry = new ProfileRegistry();
    const accounts = registry.getAllAccountsUnified();

    expect(accounts.work.context_mode).toBe('shared');
    expect(accounts.work.context_group).toBeUndefined();
    expect(accounts.work.continuity_mode).toBe('standard');
  });

  it('persists bare flag for legacy profiles', () => {
    const registry = new ProfileRegistry();
    registry.createProfile('work', { type: 'account', bare: true });

    const profile = registry.getProfile('work');
    expect(profile.bare).toBe(true);
  });

  it('persists bare flag for unified accounts and merged projection', () => {
    process.env.CCS_UNIFIED_CONFIG = '1';
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.yaml'),
      [
        'version: 8',
        'accounts:',
        '  work:',
        '    created: "2026-03-05T00:00:00.000Z"',
        '    last_used: null',
        '    bare: true',
        'profiles: {}',
        'cliproxy:',
        '  oauth_accounts: {}',
        '  providers: {}',
        '  variants: {}',
      ].join('\n'),
      'utf8'
    );

    const registry = new ProfileRegistry();

    const accounts = registry.getAllAccountsUnified();
    expect(accounts.work.bare).toBe(true);

    const merged = registry.getAllProfilesMerged();
    expect(merged.work.bare).toBe(true);
  });
});
