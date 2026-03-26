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

async function captureConsoleError<T>(fn: () => Promise<T> | T): Promise<{ result: T; messages: string[] }> {
  const originalError = console.error;
  const messages: string[] = [];

  console.error = ((...args: unknown[]) => {
    messages.push(args.map(String).join(' '));
  }) as typeof console.error;

  try {
    return {
      result: await fn(),
      messages,
    };
  } finally {
    console.error = originalError;
  }
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
      fs.writeFileSync(
        path.join(authDir, 'kiro-github-ABC123.json'),
        JSON.stringify({ type: 'kiro' })
      );
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

  it('recovers corrupted accounts.json from token-backed accounts and preserves a backup', async () => {
    await withIsolatedHome(async (homeDir) => {
      const authDir = path.join(homeDir, '.ccs', 'cliproxy', 'auth');
      const registryPath = path.join(homeDir, '.ccs', 'cliproxy', 'accounts.json');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'codex-user@example.com.json'),
        JSON.stringify({ type: 'codex', email: 'user@example.com' }),
        'utf8'
      );
      fs.writeFileSync(registryPath, '{not-valid-json', 'utf8');

      const { getProviderAccounts } = await loadAccountManager();
      const accounts = getProviderAccounts('codex');
      const { loadAccountsRegistry } = await loadRegistryModule();
      const registry = loadAccountsRegistry();

      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.id).toBe('user@example.com');
      expect(accounts[0]?.isDefault).toBe(true);
      expect(registry.providers.codex?.accounts['user@example.com']?.tokenFile).toBe(
        'codex-user@example.com.json'
      );

      const backups = fs
        .readdirSync(path.dirname(registryPath))
        .filter((file) => /^accounts\.json\.corrupt-.*\.bak$/.test(file));
      expect(backups).toHaveLength(1);
      expect(
        fs.readFileSync(path.join(path.dirname(registryPath), backups[0] as string), 'utf8')
      ).toBe('{not-valid-json');
    });
  });

  it('recovers paused token-backed accounts when rebuilding a corrupted registry', async () => {
    await withIsolatedHome(async (homeDir) => {
      const pausedDir = path.join(homeDir, '.ccs', 'cliproxy', 'auth-paused');
      const registryPath = path.join(homeDir, '.ccs', 'cliproxy', 'accounts.json');
      fs.mkdirSync(pausedDir, { recursive: true });
      fs.writeFileSync(
        path.join(pausedDir, 'codex-paused@example.com.json'),
        JSON.stringify({ type: 'codex', email: 'paused@example.com' }),
        'utf8'
      );
      fs.writeFileSync(registryPath, '{"providers":', 'utf8');

      const { getProviderAccounts } = await loadAccountManager();
      const accounts = getProviderAccounts('codex');

      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.id).toBe('paused@example.com');
      expect(accounts[0]?.paused).toBe(true);
    });
  });

  it('surfaces skipped token files only during corruption recovery', async () => {
    await withIsolatedHome(async (homeDir) => {
      const authDir = path.join(homeDir, '.ccs', 'cliproxy', 'auth');
      const registryPath = path.join(homeDir, '.ccs', 'cliproxy', 'accounts.json');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'codex-valid@example.com.json'),
        JSON.stringify({ type: 'codex', email: 'valid@example.com' }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(authDir, 'codex-invalid@example.com.json'),
        JSON.stringify({ type: 123, email: 'invalid@example.com' }),
        'utf8'
      );
      fs.writeFileSync(registryPath, '{"providers":', 'utf8');

      const { getProviderAccounts } = await loadAccountManager();
      const { result: accounts, messages } = await captureConsoleError(() =>
        getProviderAccounts('codex')
      );

      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.id).toBe('valid@example.com');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('Recovered corrupted account registry');
      expect(messages[0]).toContain('auth/codex-invalid@example.com.json');
      expect(messages[0]).toContain('invalid token type');
    });
  });

  it('prefers active tokens over paused duplicates during corruption recovery', async () => {
    await withIsolatedHome(async (homeDir) => {
      const cliproxyDir = path.join(homeDir, '.ccs', 'cliproxy');
      const authDir = path.join(cliproxyDir, 'auth');
      const pausedDir = path.join(cliproxyDir, 'auth-paused');
      const registryPath = path.join(cliproxyDir, 'accounts.json');
      fs.mkdirSync(authDir, { recursive: true });
      fs.mkdirSync(pausedDir, { recursive: true });

      fs.writeFileSync(
        path.join(authDir, 'codex-shared@example.com.json'),
        JSON.stringify({ type: 'codex', email: 'active@example.com' }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(pausedDir, 'codex-shared@example.com.json'),
        JSON.stringify({ type: 'codex', email: 'paused@example.com' }),
        'utf8'
      );
      fs.writeFileSync(registryPath, '{"providers":', 'utf8');

      const { getProviderAccounts } = await loadAccountManager();
      const accounts = getProviderAccounts('codex');

      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.id).toBe('active@example.com');
      expect(accounts[0]?.tokenFile).toBe('codex-shared@example.com.json');
      expect(accounts[0]?.paused).toBeUndefined();
    });
  });

  it('does not repopulate paused tokens during normal startup discovery', async () => {
    await withIsolatedHome(async (homeDir) => {
      const pausedDir = path.join(homeDir, '.ccs', 'cliproxy', 'auth-paused');
      const registryPath = path.join(homeDir, '.ccs', 'cliproxy', 'accounts.json');
      fs.mkdirSync(pausedDir, { recursive: true });
      fs.writeFileSync(
        path.join(pausedDir, 'codex-paused@example.com.json'),
        JSON.stringify({ type: 'codex', email: 'paused@example.com' }),
        'utf8'
      );

      const { discoverExistingAccounts } = await loadRegistryModule();
      discoverExistingAccounts();

      expect(fs.existsSync(registryPath)).toBe(false);

      const { getProviderAccounts } = await loadAccountManager();
      expect(getProviderAccounts('codex')).toEqual([]);
    });
  });
});
