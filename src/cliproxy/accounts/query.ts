/**
 * Account query and search operations
 * Finding, filtering, and retrieving account information
 */

import { CLIProxyProvider } from '../types';
import { CLIPROXY_PROFILES } from '../../auth/profile-detector';
import { AccountInfo } from './types';
import { loadAccountsRegistry, syncRegistryWithTokenFiles } from './registry';

/**
 * Get all accounts for a provider
 */
export function getProviderAccounts(provider: CLIProxyProvider): AccountInfo[] {
  const registry = loadAccountsRegistry();

  // Sync in-memory view with actual token files without mutating disk on read.
  syncRegistryWithTokenFiles(registry);

  const providerAccounts = registry.providers[provider];

  if (!providerAccounts) {
    return [];
  }

  return Object.entries(providerAccounts.accounts).map(([id, meta]) => ({
    id,
    provider,
    isDefault: id === providerAccounts.default,
    ...meta,
  }));
}

/**
 * Get default account for a provider
 */
export function getDefaultAccount(provider: CLIProxyProvider): AccountInfo | null {
  const accounts = getProviderAccounts(provider);
  return accounts.find((a) => a.isDefault) || accounts[0] || null;
}

/**
 * Get specific account by ID
 */
export function getAccount(provider: CLIProxyProvider, accountId: string): AccountInfo | null {
  const accounts = getProviderAccounts(provider);
  return accounts.find((a) => a.id === accountId) || null;
}

/**
 * Find account by query (nickname, email, or id)
 * Supports partial matching for convenience
 */
export function findAccountByQuery(provider: CLIProxyProvider, query: string): AccountInfo | null {
  const accounts = getProviderAccounts(provider);
  const lowerQuery = query.toLowerCase();

  // Exact match first (id, email, nickname)
  const exactMatch = accounts.find(
    (a) =>
      a.id === query ||
      a.email?.toLowerCase() === lowerQuery ||
      a.nickname?.toLowerCase() === lowerQuery
  );
  if (exactMatch) return exactMatch;

  // Partial match on nickname or email prefix
  const partialMatches = accounts.filter(
    (a) =>
      a.nickname?.toLowerCase().startsWith(lowerQuery) ||
      a.email?.toLowerCase().startsWith(lowerQuery)
  );
  return partialMatches.length === 1 ? partialMatches[0] : null;
}

/**
 * Get non-paused accounts for a provider
 */
export function getActiveAccounts(provider: CLIProxyProvider): AccountInfo[] {
  return getProviderAccounts(provider).filter((a) => !a.paused);
}

/**
 * Check if an account is paused
 */
export function isAccountPaused(provider: CLIProxyProvider, accountId: string): boolean {
  const accounts = getProviderAccounts(provider);
  const account = accounts.find((a) => a.id === accountId);
  return account?.paused ?? false;
}

/**
 * Get summary of all accounts across providers
 */
export function getAllAccountsSummary(): Record<CLIProxyProvider, AccountInfo[]> {
  const providers: CLIProxyProvider[] = [...CLIPROXY_PROFILES];
  const summary: Record<CLIProxyProvider, AccountInfo[]> = {} as Record<
    CLIProxyProvider,
    AccountInfo[]
  >;

  for (const provider of providers) {
    summary[provider] = getProviderAccounts(provider);
  }

  return summary;
}
