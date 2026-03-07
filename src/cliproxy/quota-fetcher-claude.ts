/**
 * Quota Fetcher for Claude (Anthropic) Accounts
 *
 * Fetches policy limits from Claude API and normalizes 5h + weekly windows.
 */

import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { getAuthDir } from './config-generator';
import { getPausedDir, getProviderAccounts } from './account-manager';
import { sanitizeEmail, isTokenExpired } from './auth-utils';
import type { ClaudeQuotaResult } from './quota-types';
import {
  buildClaudeQuotaWindows,
  buildClaudeCoreUsageSummary,
} from './quota-fetcher-claude-normalizer';

export { buildClaudeQuotaWindows, buildClaudeCoreUsageSummary };

export const CLAUDE_POLICY_LIMITS_URL = 'https://api.anthropic.com/api/claude_code/policy_limits';
const CLAUDE_QUOTA_TIMEOUT_MS = 10000;
const CLAUDE_QUOTA_MAX_ATTEMPTS = 2;
const CLAUDE_USER_AGENT = 'ccs-cli/claude-quota';
const CLAUDE_OAUTH_UNSUPPORTED_MESSAGE = 'oauth authentication is currently not supported';

interface ClaudeAuthData {
  accessToken: string;
  isExpired: boolean;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractAccessToken(data: Record<string, unknown>): string | null {
  const direct = asString(data['access_token']);
  if (direct) return direct;

  const nested = toObject(data['token']);
  if (nested) {
    const nestedToken = asString(nested['access_token']);
    if (nestedToken) return nestedToken;
  }

  return null;
}

function extractExpiry(data: Record<string, unknown>): string | null {
  const direct = asString(data['expired']);
  if (direct) return direct;

  const nested = toObject(data['token']);
  if (nested) {
    return asString(nested['expiry']);
  }

  return null;
}

function isAuthExpired(expiry: string | null): boolean {
  return expiry ? isTokenExpired(expiry) : false;
}

function extractErrorMessage(payload: unknown): string | null {
  const root = toObject(payload);
  if (!root) return null;

  const direct = asString(root['message']);
  if (direct) return direct;

  const nested = toObject(root['error']);
  if (!nested) return null;
  return asString(nested['message']);
}

async function readResponseErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = await response.text();
    if (!body || body.trim().length === 0) return null;

    try {
      const parsed = JSON.parse(body) as unknown;
      const extracted = extractErrorMessage(parsed);
      if (extracted) return extracted;
    } catch {
      // fall through to plain-text fallback
    }

    return body.trim();
  } catch {
    return null;
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return toObject(parsed);
  } catch {
    return null;
  }
}

async function readAuthCandidate(filePath: string): Promise<ClaudeAuthData | null> {
  const data = await readJsonFile(filePath);
  if (!data) return null;

  const accessToken = extractAccessToken(data);
  if (!accessToken) return null;

  const expiry = extractExpiry(data);
  return {
    accessToken,
    isExpired: isAuthExpired(expiry),
  };
}

async function readClaudeAuthData(accountId: string): Promise<ClaudeAuthData | null> {
  const authDirs = [getAuthDir(), getPausedDir()];
  const sanitizedId = sanitizeEmail(accountId);
  const expectedFiles = [`claude-${sanitizedId}.json`, `anthropic-${sanitizedId}.json`];

  for (const authDir of authDirs) {
    for (const expectedFile of expectedFiles) {
      const filePath = path.join(authDir, expectedFile);
      const authData = await readAuthCandidate(filePath);
      if (authData) {
        return authData;
      }
    }

    let files: string[];
    try {
      files = await fsp.readdir(authDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (
        !file.endsWith('.json') ||
        (!file.startsWith('claude-') && !file.startsWith('anthropic-'))
      ) {
        continue;
      }

      const filePath = path.join(authDir, file);
      const data = await readJsonFile(filePath);
      if (!data) continue;

      const accessToken = extractAccessToken(data);
      if (!accessToken) continue;

      const fileEmail = asString(data['email']);
      const typeValue = asString(data['type']);
      const isClaudeType =
        typeValue === null || typeValue === 'claude' || typeValue === 'anthropic';
      const matchesEmail = fileEmail === accountId;
      const matchesFile = file.includes(sanitizedId);

      if ((matchesEmail || matchesFile) && isClaudeType) {
        const expiry = extractExpiry(data);
        return {
          accessToken,
          isExpired: isAuthExpired(expiry),
        };
      }
    }
  }

  return null;
}

function buildEmptyResult(
  error: string,
  accountId: string,
  needsReauth = false
): ClaudeQuotaResult {
  return {
    success: false,
    windows: [],
    coreUsage: { fiveHour: null, weekly: null },
    lastUpdated: Date.now(),
    error,
    accountId,
    needsReauth,
  };
}

function buildPolicyUnavailableResult(accountId: string): ClaudeQuotaResult {
  return {
    success: true,
    windows: [],
    coreUsage: { fiveHour: null, weekly: null },
    lastUpdated: Date.now(),
    accountId,
  };
}

/**
 * Fetch quota for a single Claude account.
 */
export async function fetchClaudeQuota(
  accountId: string,
  verbose = false
): Promise<ClaudeQuotaResult> {
  const authData = await readClaudeAuthData(accountId);
  if (!authData) {
    return buildEmptyResult('Auth file not found for Claude account', accountId);
  }

  if (authData.isExpired) {
    return buildEmptyResult(
      'Token expired - re-authenticate with ccs cliproxy auth claude',
      accountId,
      true
    );
  }

  let lastError = 'Unknown error';

  for (let attempt = 1; attempt <= CLAUDE_QUOTA_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLAUDE_QUOTA_TIMEOUT_MS);

    try {
      const response = await fetch(CLAUDE_POLICY_LIMITS_URL, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${authData.accessToken}`,
          Accept: 'application/json',
          'User-Agent': CLAUDE_USER_AGENT,
        },
      });

      clearTimeout(timeoutId);
      if (verbose) {
        console.error(`[i] Claude policy limits status: ${response.status} (attempt ${attempt})`);
      }

      if (response.status === 401) {
        const errorMessage = await readResponseErrorMessage(response);
        if (errorMessage && errorMessage.toLowerCase().includes(CLAUDE_OAUTH_UNSUPPORTED_MESSAGE)) {
          if (verbose) {
            console.error(
              '[i] Claude policy limits endpoint does not support OAuth tokens; treating quota as unavailable'
            );
          }
          return buildPolicyUnavailableResult(accountId);
        }

        return buildEmptyResult('Authentication required for policy limits', accountId, true);
      }

      if (response.status === 404) {
        // Some accounts may not expose policy limits; treat as unavailable but successful.
        return buildPolicyUnavailableResult(accountId);
      }

      if (response.status === 403) {
        return buildEmptyResult('Not authorized for policy limits', accountId);
      }

      if (!response.ok) {
        lastError = `Policy limits API error: ${response.status}`;
        if (
          attempt < CLAUDE_QUOTA_MAX_ATTEMPTS &&
          (response.status === 429 || response.status >= 500)
        ) {
          continue;
        }
        return buildEmptyResult(lastError, accountId);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return buildEmptyResult('Invalid policy limits format', accountId);
      }

      if (!toObject(payload)) {
        return buildEmptyResult('Invalid policy limits format', accountId);
      }

      const windows = buildClaudeQuotaWindows(payload as Record<string, unknown>);
      const coreUsage = buildClaudeCoreUsageSummary(windows);

      return {
        success: true,
        windows,
        coreUsage,
        lastUpdated: Date.now(),
        accountId,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      lastError =
        error instanceof Error && error.name === 'AbortError'
          ? 'Policy limits request timeout'
          : error instanceof Error
            ? error.message
            : 'Unknown error';

      if (verbose) {
        const errorDetails =
          error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error);
        console.error(
          `[!] Claude policy limits failed (attempt ${attempt}): ${lastError}${errorDetails ? `\n${errorDetails}` : ''}`
        );
      }

      if (attempt >= CLAUDE_QUOTA_MAX_ATTEMPTS) {
        return buildEmptyResult(lastError, accountId);
      }
    }
  }

  return buildEmptyResult(lastError, accountId);
}

/**
 * Fetch quota for all Claude accounts.
 */
export async function fetchAllClaudeQuotas(
  verbose = false
): Promise<{ account: string; quota: ClaudeQuotaResult }[]> {
  const accounts = getProviderAccounts('claude');
  const results = await Promise.all(
    accounts.map(async (account) => ({
      account: account.id,
      quota: await fetchClaudeQuota(account.id, verbose),
    }))
  );
  return results;
}
