import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runWithScopedCcsHome } from '../../../src/utils/config-manager';

async function loadAccountManager() {
  return import(`../../../src/cliproxy/account-manager?optional-nickname=${Date.now()}`);
}

async function withIsolatedHome<T>(fn: () => Promise<T> | T): Promise<T> {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-optional-nickname-'));
  try {
    return await runWithScopedCcsHome(testDir, fn);
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

describe('registerAccount optional nickname flow', () => {
  it('uses a filename-derived id when Kiro/GHCP nickname is omitted', async () => {
    const account = await withIsolatedHome(async () => {
      const { registerAccount } = await loadAccountManager();
      return registerAccount('kiro', 'kiro-github-ABC123.json');
    });

    expect(account.id).toBe('github-ABC123');
    expect(account.nickname).toBe('github-ABC123');
  });

  it('falls back to provider-scoped sequential ids when the filename is not descriptive', async () => {
    const { first, second } = await withIsolatedHome(async () => {
      const { registerAccount } = await loadAccountManager();
      return {
        first: registerAccount('kiro', 'kiro-nomail.json'),
        second: registerAccount('kiro', 'kiro-second.json'),
      };
    });

    expect(first.id).toBe('kiro-1');
    expect(first.nickname).toBe('kiro-1');
    expect(second.id).toBe('kiro-2');
    expect(second.nickname).toBe('kiro-2');
  });

  it('keeps user nicknames optional metadata separate from internal ids', async () => {
    const account = await withIsolatedHome(async () => {
      const { registerAccount } = await loadAccountManager();
      return registerAccount('ghcp', 'ghcp-amazon-XYZ789.json', undefined, 'work');
    });

    expect(account.id).toBe('amazon-XYZ789');
    expect(account.nickname).toBe('work');
  });

  it('preserves an existing custom nickname when the same token file is re-registered', async () => {
    const reauthenticated = await withIsolatedHome(async () => {
      const { registerAccount } = await loadAccountManager();
      registerAccount('kiro', 'kiro-github-ABC123.json', undefined, 'work');
      return registerAccount('kiro', 'kiro-github-ABC123.json');
    });

    expect(reauthenticated.id).toBe('github-ABC123');
    expect(reauthenticated.nickname).toBe('work');
  });

  it('rejects nickname collisions against existing account ids and nicknames', async () => {
    await withIsolatedHome(async () => {
      const { registerAccount, renameAccount } = await loadAccountManager();
      registerAccount('kiro', 'kiro-github-ABC123.json');
      const second = registerAccount('kiro', 'kiro-google-XYZ789.json', undefined, 'personal');

      expect(() =>
        registerAccount('kiro', 'kiro-google-NEW123.json', undefined, 'github-ABC123')
      ).toThrow(/already exists/i);
      expect(() => renameAccount('kiro', second.id, 'github-ABC123')).toThrow(/already used/i);
    });
  });

  it('avoids auto-generated ids that would collide with an existing nickname', async () => {
    const added = await withIsolatedHome(async () => {
      const { registerAccount } = await loadAccountManager();
      registerAccount('kiro', 'kiro-github-ABC123.json', undefined, 'google-XYZ789');
      return registerAccount('kiro', 'kiro-google-XYZ789.json');
    });

    expect(added.id).toBe('kiro-1');
    expect(added.nickname).toBe('kiro-1');
  });

  it('does not resolve ambiguous nickname prefixes to the first generated account', async () => {
    const match = await withIsolatedHome(async () => {
      const { registerAccount, findAccountByQuery } = await loadAccountManager();
      registerAccount('kiro', 'kiro-github-ABC123.json');
      registerAccount('kiro', 'kiro-github-DEF456.json');
      return findAccountByQuery('kiro', 'github');
    });

    expect(match).toBeNull();
  });
});
