/**
 * Account registry CRUD operations
 * Handles loading, saving, and syncing the accounts.json file
 */

import * as fs from 'fs';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import { CLIProxyProvider } from '../types';
import { PROVIDER_TYPE_VALUES } from '../auth/auth-types';
import { getAuthDir, getCliproxyDir } from '../config-generator';
import { AccountsRegistry, AccountInfo, PROVIDERS_WITHOUT_EMAIL } from './types';
import {
  getAccountsRegistryPath,
  getPausedDir,
  extractAccountIdFromTokenFile,
  deriveNoEmailProviderAccountId,
  generateNickname,
  hasAccountNameConflict,
  validateNickname,
  moveTokenToPaused,
  moveTokenFromPaused,
  deleteTokenFile,
  listRecoverableTokenFiles,
} from './token-file-ops';

/** Default registry structure */
function createDefaultRegistry(): AccountsRegistry {
  return {
    version: 1,
    providers: {},
  };
}

function ensureProviderRegistry(
  registry: AccountsRegistry,
  provider: CLIProxyProvider
): NonNullable<AccountsRegistry['providers'][CLIProxyProvider]> {
  if (!registry.providers[provider]) {
    registry.providers[provider] = {
      default: 'default',
      accounts: {},
    };
  }

  return registry.providers[provider] as NonNullable<
    AccountsRegistry['providers'][CLIProxyProvider]
  >;
}

function resolveProviderFromTokenType(typeValue: string): CLIProxyProvider | undefined {
  for (const [provider, typeValues] of Object.entries(PROVIDER_TYPE_VALUES)) {
    if (typeValues.includes(typeValue)) {
      return provider as CLIProxyProvider;
    }
  }

  return undefined;
}

function inferEmailFromTokenFileName(tokenFile: string): string | undefined {
  const match = tokenFile.match(/([^-]+@[^.]+\.[^.]+)(?=\.json$)/);
  return match?.[1];
}

interface RegistryPopulationIssue {
  tokenFile: string;
  paused: boolean;
  reason: string;
}

function describeRegistryPopulationIssue(issue: RegistryPopulationIssue): string {
  const sourceDir = issue.paused ? 'auth-paused' : 'auth';
  return `${sourceDir}/${issue.tokenFile} (${issue.reason})`;
}

function getRegistryPopulationIssueReason(error: unknown): string {
  if (error instanceof SyntaxError) {
    return 'invalid JSON';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'unreadable token file';
}

function populateRegistryFromTokenFiles(
  registry: AccountsRegistry,
  options: { includePaused?: boolean } = {}
): RegistryPopulationIssue[] {
  const issues: RegistryPopulationIssue[] = [];

  for (const token of listRecoverableTokenFiles(options)) {
    try {
      const content = fs.readFileSync(token.filePath, 'utf-8');
      const data = JSON.parse(content) as {
        type?: unknown;
        email?: unknown;
        project_id?: unknown;
      };
      if (typeof data.type !== 'string' || !data.type.trim()) {
        issues.push({
          tokenFile: token.tokenFile,
          paused: token.paused,
          reason: 'invalid token type',
        });
        continue;
      }

      const provider = resolveProviderFromTokenType(data.type.toLowerCase());
      if (!provider) {
        continue;
      }

      const providerAccounts = ensureProviderRegistry(registry, provider);
      const projectId =
        typeof data.project_id === 'string' && data.project_id.trim()
          ? data.project_id.trim()
          : null;
      const email =
        typeof data.email === 'string' && data.email.trim()
          ? data.email.trim()
          : inferEmailFromTokenFileName(token.tokenFile);

      const existingEntry = Object.entries(providerAccounts.accounts).find(
        ([, account]) => account.tokenFile === token.tokenFile
      );
      if (existingEntry) {
        existingEntry[1].paused = token.paused || undefined;
        if (!token.paused) {
          existingEntry[1].pausedAt = undefined;
        }
        if (provider === 'agy' && projectId) {
          existingEntry[1].projectId = projectId;
        }
        continue;
      }

      const accountId =
        PROVIDERS_WITHOUT_EMAIL.includes(provider) && !email
          ? deriveNoEmailProviderAccountId(provider, token.tokenFile, providerAccounts.accounts)
          : extractAccountIdFromTokenFile(token.tokenFile, email);

      if (providerAccounts.accounts[accountId]) {
        continue;
      }

      if (Object.keys(providerAccounts.accounts).length === 0) {
        providerAccounts.default = accountId;
      }

      const stats = fs.statSync(token.filePath);
      const accountMeta: Omit<AccountInfo, 'id' | 'provider' | 'isDefault'> = {
        email,
        nickname: email ? generateNickname(email) : accountId,
        tokenFile: token.tokenFile,
        createdAt: stats.birthtime?.toISOString() || new Date().toISOString(),
        lastUsedAt: (stats.mtime || stats.birthtime || new Date()).toISOString(),
      };

      if (token.paused) {
        accountMeta.paused = true;
      }

      if (provider === 'agy' && projectId) {
        accountMeta.projectId = projectId;
      }

      providerAccounts.accounts[accountId] = accountMeta;
    } catch (error) {
      issues.push({
        tokenFile: token.tokenFile,
        paused: token.paused,
        reason: getRegistryPopulationIssueReason(error),
      });
      continue;
    }
  }

  return issues;
}

function getCorruptedRegistryBackupPath(registryPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupBasePath = `${registryPath}.corrupt-${timestamp}`;
  let backupPath = `${backupBasePath}.bak`;
  let suffix = 1;

  while (fs.existsSync(backupPath)) {
    backupPath = `${backupBasePath}-${suffix}.bak`;
    suffix++;
  }

  return backupPath;
}

function backupCorruptedAccountsRegistry(registryPath: string): string | null {
  if (!fs.existsSync(registryPath)) {
    return null;
  }

  const backupPath = getCorruptedRegistryBackupPath(registryPath);
  fs.renameSync(registryPath, backupPath);
  return backupPath;
}

function recoverAccountsRegistryFromCorruption(registryPath: string): AccountsRegistry {
  const backupPath = backupCorruptedAccountsRegistry(registryPath);
  const recovered = createDefaultRegistry();
  const issues = populateRegistryFromTokenFiles(recovered, { includePaused: true });
  writeAccountsRegistryToDisk(recovered);

  if (issues.length > 0) {
    const recoveredFrom = backupPath || registryPath;
    console.error(
      `[!] Recovered corrupted account registry from ${recoveredFrom}, but skipped ${issues.length} token file(s): ${issues
        .map(describeRegistryPopulationIssue)
        .join(', ')}`
    );
  }

  return recovered;
}

function withAccountsRegistryLock<T>(callback: () => T): T {
  const lockTarget = getCliproxyDir();
  let release: (() => void) | undefined;

  if (!fs.existsSync(lockTarget)) {
    fs.mkdirSync(lockTarget, { recursive: true, mode: 0o700 });
  }

  try {
    release = lockfile.lockSync(lockTarget, { stale: 10000 }) as () => void;
    return callback();
  } finally {
    if (release) {
      try {
        release();
      } catch {
        // Best-effort release
      }
    }
  }
}

function readAccountsRegistryFromDisk(): AccountsRegistry {
  const registryPath = getAccountsRegistryPath();

  if (!fs.existsSync(registryPath)) {
    return createDefaultRegistry();
  }

  const content = fs.readFileSync(registryPath, 'utf-8');
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return recoverAccountsRegistryFromCorruption(registryPath);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return recoverAccountsRegistryFromCorruption(registryPath);
  }

  const parsed = data as { version?: unknown; providers?: unknown };
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    providers:
      parsed.providers && typeof parsed.providers === 'object'
        ? (parsed.providers as AccountsRegistry['providers'])
        : {},
  };
}

function writeAccountsRegistryToDisk(registry: AccountsRegistry): void {
  const registryPath = getAccountsRegistryPath();
  const dir = path.dirname(registryPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const tempPath = `${registryPath}.tmp.${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(registry, null, 2) + '\n', {
    mode: 0o600,
  });
  fs.renameSync(tempPath, registryPath);
}

function mutateAccountsRegistry<T>(mutator: (registry: AccountsRegistry) => T): T {
  return withAccountsRegistryLock(() => {
    const registry = readAccountsRegistryFromDisk();
    const initialSnapshot = JSON.stringify(registry);
    const result = mutator(registry);
    if (JSON.stringify(registry) !== initialSnapshot) {
      writeAccountsRegistryToDisk(registry);
    }
    return result;
  });
}

/**
 * Load accounts registry
 */
export function loadAccountsRegistry(): AccountsRegistry {
  return withAccountsRegistryLock(() => readAccountsRegistryFromDisk());
}

/**
 * Save accounts registry
 */
export function saveAccountsRegistry(registry: AccountsRegistry): void {
  withAccountsRegistryLock(() => {
    writeAccountsRegistryToDisk(registry);
  });
}

/**
 * Sync registry with actual token files
 * Removes stale entries where token file no longer exists
 * For paused accounts, checks both auth/ and paused/ directories
 * Called automatically when loading accounts
 */
export function syncRegistryWithTokenFiles(registry: AccountsRegistry): boolean {
  const authDir = getAuthDir();
  const pausedDir = getPausedDir();
  let modified = false;

  for (const [_providerName, providerAccounts] of Object.entries(registry.providers)) {
    if (!providerAccounts) continue;

    const staleIds: string[] = [];

    for (const [accountId, meta] of Object.entries(providerAccounts.accounts)) {
      const tokenPath = path.join(authDir, meta.tokenFile);
      const pausedPath = path.join(pausedDir, meta.tokenFile);

      // For paused accounts, check paused dir; for active accounts, check auth dir
      const expectedPath = meta.paused ? pausedPath : tokenPath;
      // Also accept if file exists in either location (handles edge cases)
      const existsAnywhere = fs.existsSync(tokenPath) || fs.existsSync(pausedPath);

      if (!fs.existsSync(expectedPath) && !existsAnywhere) {
        staleIds.push(accountId);
      }
    }

    // Remove stale accounts
    for (const id of staleIds) {
      delete providerAccounts.accounts[id];
      modified = true;

      // Update default if deleted
      if (providerAccounts.default === id) {
        const remainingIds = Object.keys(providerAccounts.accounts);
        providerAccounts.default = remainingIds[0] || 'default';
      }
    }
  }

  return modified;
}

/**
 * Register a new account
 * Called after successful OAuth to record the account
 *
 * For providers without email (kiro, ghcp):
 * - internal accountId is derived from token metadata
 * - nickname is optional metadata
 *
 * For providers with email:
 * - email is used as accountId
 * - nickname is auto-generated from email if not provided
 */
export function registerAccount(
  provider: CLIProxyProvider,
  tokenFile: string,
  email?: string,
  nickname?: string,
  projectId?: string
): AccountInfo {
  return mutateAccountsRegistry((registry) => {
    syncRegistryWithTokenFiles(registry);

    if (!registry.providers[provider]) {
      registry.providers[provider] = {
        default: 'default',
        accounts: {},
      };
    }

    const providerAccounts = registry.providers[provider];
    if (!providerAccounts) {
      throw new Error('Failed to initialize provider accounts');
    }

    let accountId: string;
    let accountNickname: string;

    if (PROVIDERS_WITHOUT_EMAIL.includes(provider)) {
      accountId = email
        ? extractAccountIdFromTokenFile(tokenFile, email)
        : deriveNoEmailProviderAccountId(provider, tokenFile, providerAccounts.accounts);
      const existingAccount = providerAccounts.accounts[accountId];

      if (nickname) {
        const validationError = validateNickname(nickname);
        if (validationError) {
          throw new Error(validationError);
        }

        const existingAccounts = Object.entries(providerAccounts.accounts).map(([id, account]) => ({
          id,
          nickname: account.nickname,
        }));
        if (hasAccountNameConflict(existingAccounts, nickname, accountId)) {
          throw new Error(
            `An account with nickname "${nickname}" already exists for ${provider}. ` +
              `Choose a different nickname.`
          );
        }
      }

      accountNickname =
        nickname || existingAccount?.nickname || (email ? generateNickname(email) : accountId);
    } else {
      accountId = extractAccountIdFromTokenFile(tokenFile, email);
      accountNickname = nickname || generateNickname(email);
    }

    const isFirstAccount = Object.keys(providerAccounts.accounts).length === 0;
    const existingAccount = providerAccounts.accounts[accountId];
    const accountMeta: Omit<AccountInfo, 'id' | 'provider' | 'isDefault'> = {
      email,
      nickname: accountNickname,
      tokenFile,
      createdAt: existingAccount?.createdAt || new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };

    if (provider === 'agy' && projectId) {
      accountMeta.projectId = projectId;
    }

    providerAccounts.accounts[accountId] = accountMeta;

    if (isFirstAccount) {
      providerAccounts.default = accountId;
    }

    return {
      id: accountId,
      provider,
      isDefault: accountId === providerAccounts.default,
      email,
      nickname: accountNickname,
      tokenFile,
      createdAt: providerAccounts.accounts[accountId].createdAt,
      lastUsedAt: providerAccounts.accounts[accountId].lastUsedAt,
      projectId: providerAccounts.accounts[accountId].projectId,
    };
  });
}

/**
 * Set default account for a provider
 */
export function setDefaultAccount(provider: CLIProxyProvider, accountId: string): boolean {
  return mutateAccountsRegistry((registry) => {
    const providerAccounts = registry.providers[provider];

    if (!providerAccounts || !providerAccounts.accounts[accountId]) {
      return false;
    }

    providerAccounts.default = accountId;
    return true;
  });
}

/**
 * Pause an account (skip in quota rotation)
 * Moves token file to paused/ subdir so CLIProxyAPI won't discover it
 */
export function pauseAccount(provider: CLIProxyProvider, accountId: string): boolean {
  return mutateAccountsRegistry((registry) => {
    const providerAccounts = registry.providers[provider];

    if (!providerAccounts?.accounts[accountId]) {
      return false;
    }

    const accountMeta = providerAccounts.accounts[accountId];
    if (accountMeta.paused) {
      return true;
    }

    if (!moveTokenToPaused(accountMeta.tokenFile)) {
      return false;
    }

    providerAccounts.accounts[accountId].paused = true;
    providerAccounts.accounts[accountId].pausedAt = new Date().toISOString();
    return true;
  });
}

/**
 * Resume a paused account
 * Moves token file back from paused/ to auth/ so CLIProxyAPI can discover it
 */
export function resumeAccount(provider: CLIProxyProvider, accountId: string): boolean {
  return mutateAccountsRegistry((registry) => {
    const providerAccounts = registry.providers[provider];

    if (!providerAccounts?.accounts[accountId]) {
      return false;
    }

    const accountMeta = providerAccounts.accounts[accountId];
    if (!accountMeta.paused) {
      return true;
    }

    if (!moveTokenFromPaused(accountMeta.tokenFile)) {
      return false;
    }

    providerAccounts.accounts[accountId].paused = false;
    providerAccounts.accounts[accountId].pausedAt = undefined;
    return true;
  });
}

/**
 * Remove an account
 */
export function removeAccount(provider: CLIProxyProvider, accountId: string): boolean {
  return mutateAccountsRegistry((registry) => {
    const providerAccounts = registry.providers[provider];

    if (!providerAccounts || !providerAccounts.accounts[accountId]) {
      return false;
    }

    const tokenFile = providerAccounts.accounts[accountId].tokenFile;
    if (!deleteTokenFile(tokenFile)) {
      return false;
    }

    delete providerAccounts.accounts[accountId];

    const remainingAccounts = Object.keys(providerAccounts.accounts);
    if (providerAccounts.default === accountId && remainingAccounts.length > 0) {
      providerAccounts.default = remainingAccounts[0];
    }

    return true;
  });
}

/**
 * Rename an account's nickname
 */
export function renameAccount(
  provider: CLIProxyProvider,
  accountId: string,
  newNickname: string
): boolean {
  const validationError = validateNickname(newNickname);
  if (validationError) {
    throw new Error(validationError);
  }

  return mutateAccountsRegistry((registry) => {
    const providerAccounts = registry.providers[provider];

    if (!providerAccounts?.accounts[accountId]) {
      return false;
    }

    const existingAccounts = Object.entries(providerAccounts.accounts).map(([id, account]) => ({
      id,
      nickname: account.nickname,
    }));
    if (hasAccountNameConflict(existingAccounts, newNickname, accountId)) {
      throw new Error(`Nickname "${newNickname}" is already used by another account`);
    }

    providerAccounts.accounts[accountId].nickname = newNickname;
    return true;
  });
}

/**
 * Update last used timestamp for an account
 */
export function touchAccount(provider: CLIProxyProvider, accountId: string): void {
  mutateAccountsRegistry((registry) => {
    const providerAccounts = registry.providers[provider];
    if (providerAccounts?.accounts[accountId]) {
      providerAccounts.accounts[accountId].lastUsedAt = new Date().toISOString();
    }
  });
}

/**
 * Update account tier
 */
export function setAccountTier(
  provider: CLIProxyProvider,
  accountId: string,
  tier: 'free' | 'pro' | 'ultra' | 'unknown'
): boolean {
  return mutateAccountsRegistry((registry) => {
    const providerAccounts = registry.providers[provider];

    if (!providerAccounts?.accounts[accountId]) {
      return false;
    }

    providerAccounts.accounts[accountId].tier = tier;
    return true;
  });
}

/**
 * Auto-discover accounts from existing token files
 * Called during migration or first run to populate accounts registry
 *
 * For kiro/ghcp providers without email, generates unique accountId from:
 * 1. OAuth provider + profile ID from filename (e.g., github-ABC123)
 * 2. Fallback: provider + index (e.g., kiro-1, kiro-2)
 */
export function discoverExistingAccounts(): void {
  if (!fs.existsSync(getAuthDir())) {
    return;
  }
  mutateAccountsRegistry((registry) => {
    syncRegistryWithTokenFiles(registry);
    populateRegistryFromTokenFiles(registry);
  });
}
