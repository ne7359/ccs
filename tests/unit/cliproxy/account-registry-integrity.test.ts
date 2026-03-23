import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runWithScopedCcsHome } from '../../../src/utils/config-manager';

async function withIsolatedHome<T>(fn: (homeDir: string) => Promise<T> | T): Promise<T> {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-account-registry-'));
  try {
    return await runWithScopedCcsHome(homeDir, () => fn(homeDir));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

async function loadRegistryModule() {
  return import(`../../../src/cliproxy/accounts/registry?registry-integrity=${Date.now()}`);
}

async function loadAccountManager() {
  return import(`../../../src/cliproxy/account-manager?account-registry-integrity=${Date.now()}`);
}

describe('account registry integrity', () => {
  it('does not create accounts.json during no-op discovery', async () => {
    await withIsolatedHome(async (homeDir) => {
      const authDir = path.join(homeDir, '.ccs', 'cliproxy', 'auth');
      const registryPath = path.join(homeDir, '.ccs', 'cliproxy', 'accounts.json');
      fs.mkdirSync(authDir, { recursive: true });

      const { discoverExistingAccounts } = await loadRegistryModule();
      discoverExistingAccounts();

      expect(fs.existsSync(registryPath)).toBe(false);
    });
  });

  it('does not write accounts.json during provider account reads', async () => {
    await withIsolatedHome(async (homeDir) => {
      const authDir = path.join(homeDir, '.ccs', 'cliproxy', 'auth');
      const registryPath = path.join(homeDir, '.ccs', 'cliproxy', 'accounts.json');
      fs.mkdirSync(authDir, { recursive: true });

      const { getProviderAccounts } = await loadAccountManager();
      expect(getProviderAccounts('kiro')).toEqual([]);
      expect(fs.existsSync(registryPath)).toBe(false);
    });
  });

  it('removes stale accounts before choosing the next default during registration', async () => {
    await withIsolatedHome(async (homeDir) => {
      const cliproxyDir = path.join(homeDir, '.ccs', 'cliproxy');
      const authDir = path.join(cliproxyDir, 'auth');
      const registryPath = path.join(cliproxyDir, 'accounts.json');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(path.join(authDir, 'kiro-github-ABC123.json'), JSON.stringify({ type: 'kiro' }));
      fs.writeFileSync(
        registryPath,
        JSON.stringify({
          version: 1,
          providers: {
            kiro: {
              default: 'github-OLD999',
              accounts: {
                'github-OLD999': {
                  nickname: 'old',
                  tokenFile: 'kiro-github-OLD999.json',
                  createdAt: '2025-01-01T00:00:00.000Z',
                  lastUsedAt: '2025-01-01T00:00:00.000Z',
                },
              },
            },
          },
        }),
        'utf8'
      );

      const { registerAccount } = await loadAccountManager();
      const account = registerAccount('kiro', 'kiro-github-ABC123.json');

      const { loadAccountsRegistry } = await loadRegistryModule();
      const registry = loadAccountsRegistry();
      const kiroAccounts = registry.providers.kiro;

      expect(account.id).toBe('github-ABC123');
      expect(kiroAccounts?.default).toBe('github-ABC123');
      expect(kiroAccounts?.accounts['github-OLD999']).toBeUndefined();
      expect(Object.keys(kiroAccounts?.accounts ?? {})).toEqual(['github-ABC123']);
    });
  });

  it('fails closed on corrupted accounts.json', async () => {
    await withIsolatedHome(async (homeDir) => {
      const registryPath = path.join(homeDir, '.ccs', 'cliproxy', 'accounts.json');
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, '{not-valid-json', 'utf8');

      const { loadAccountsRegistry } = await loadRegistryModule();
      expect(() => loadAccountsRegistry()).toThrow(/corrupted/i);
    });
  });
});
