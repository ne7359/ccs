/**
 * Gemini Token Refresh
 *
 * Handles proactive token validation and refresh for Gemini OAuth tokens.
 * Prevents UND_ERR_SOCKET errors by ensuring tokens are valid before use.
 *
 * Token sources (priority order):
 * 1. CLIProxy auth dir (~/.ccs/cliproxy/auth/) - CCS-managed tokens
 * 2. Standard Gemini CLI (~/.gemini/oauth_creds.json) - backward compatibility
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getProviderAuthDir } from '../config-generator';
import { getDefaultAccount, getProviderAccounts } from '../account-manager';
import { isTokenFileForProvider } from './token-manager';

/** Google OAuth token endpoint */
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Refresh tokens 5 minutes before expiry */
const REFRESH_LEAD_TIME_MS = 5 * 60 * 1000;

const GEMINI_CLIENT_ID_ENV_KEYS = ['CCS_GEMINI_OAUTH_CLIENT_ID', 'OPENCLAW_GEMINI_OAUTH_CLIENT_ID'];
const GEMINI_CLIENT_SECRET_ENV_KEYS = [
  'CCS_GEMINI_OAUTH_CLIENT_SECRET',
  'OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET',
];

/** Gemini oauth_creds.json structure */
interface GeminiOAuthCreds {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number; // Unix timestamp in milliseconds
  scope?: string;
  token_type?: string;
  id_token?: string;
  client_id?: string;
  client_secret?: string;
  token_uri?: string;
}

/** Gemini credentials with source path for write-back */
interface GeminiCredsWithSource {
  creds: GeminiOAuthCreds;
  sourcePath: string;
}

/** CLIProxyAPI Gemini token structure (from GeminiTokenStorage Go struct) */
interface CliproxyGeminiToken {
  token: {
    access_token: string;
    refresh_token?: string;
    expiry?: number; // Unix timestamp in milliseconds
    client_id?: string;
    client_secret?: string;
    token_uri?: string;
  };
  project_id: string;
  email: string;
  type: 'gemini';
}

/** Token refresh response from Google */
interface TokenRefreshResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleOAuthClientCredentials {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
}

/**
 * Get path to Gemini OAuth credentials file
 */
export function getGeminiOAuthPath(): string {
  return path.join(os.homedir(), '.gemini', 'oauth_creds.json');
}

/**
 * Map CLIProxyAPI token format to internal GeminiOAuthCreds format
 */
function mapCliproxyToGeminiCreds(cliproxy: CliproxyGeminiToken): GeminiOAuthCreds {
  return {
    access_token: cliproxy.token.access_token,
    refresh_token: cliproxy.token.refresh_token,
    expiry_date: cliproxy.token.expiry,
    token_type: 'Bearer',
    client_id: cliproxy.token.client_id,
    client_secret: cliproxy.token.client_secret,
    token_uri: cliproxy.token.token_uri,
  };
}

/**
 * Validate CLIProxyAPI token structure has required fields
 */
function isValidCliproxyToken(data: unknown): data is CliproxyGeminiToken {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (obj.type !== 'gemini') return false;
  if (typeof obj.token !== 'object' || obj.token === null) return false;
  const token = obj.token as Record<string, unknown>;
  return typeof token.access_token === 'string';
}

function getFirstEnvValue(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveGeminiRefreshCredentials(creds: GeminiOAuthCreds): {
  credentials?: GoogleOAuthClientCredentials;
  error?: string;
} {
  const clientId = creds.client_id?.trim() || getFirstEnvValue(GEMINI_CLIENT_ID_ENV_KEYS);
  const clientSecret =
    creds.client_secret?.trim() || getFirstEnvValue(GEMINI_CLIENT_SECRET_ENV_KEYS);

  if (!clientId || !clientSecret) {
    return {
      error:
        'Gemini token refresh unavailable: missing OAuth client credentials in the token file. ' +
        'Re-authenticate with CLIProxy or set CCS_GEMINI_OAUTH_CLIENT_ID and CCS_GEMINI_OAUTH_CLIENT_SECRET.',
    };
  }

  return {
    credentials: {
      clientId,
      clientSecret,
      tokenUrl: creds.token_uri?.trim() || GOOGLE_TOKEN_URL,
    },
  };
}

/**
 * Read Gemini token from CLIProxy auth directory
 * Returns credentials with source path, or null if no valid token found
 */
function readCliproxyGeminiCreds(accountId?: string): GeminiCredsWithSource | null {
  const authDir = getProviderAuthDir('gemini');
  if (!fs.existsSync(authDir)) return null;

  let tokenPath: string | null = null;
  const normalizedAccountId = accountId?.trim();
  const accounts = getProviderAccounts('gemini');

  // Account-specific refresh path (used by background worker)
  if (normalizedAccountId) {
    const targetAccount = accounts.find((account) => account.id === normalizedAccountId);
    if (!targetAccount) {
      return null;
    }

    tokenPath = path.join(authDir, targetAccount.tokenFile);
  }

  if (!normalizedAccountId) {
    // Try to find default account's token file
    const defaultAccount = getDefaultAccount('gemini');
    if (defaultAccount) {
      tokenPath = path.join(authDir, defaultAccount.tokenFile);
      if (!fs.existsSync(tokenPath)) tokenPath = null;
    }

    // Fallback: find any gemini account token file
    if (!tokenPath && accounts.length > 0) {
      tokenPath = path.join(authDir, accounts[0].tokenFile);
      if (!fs.existsSync(tokenPath)) tokenPath = null;
    }

    // Last fallback: scan directory for gemini token files
    if (!tokenPath) {
      try {
        const files = fs.readdirSync(authDir).filter((f) => f.endsWith('.json'));
        for (const file of files) {
          const filePath = path.join(authDir, file);
          if (file.startsWith('gemini-') || isTokenFileForProvider(filePath, 'gemini')) {
            tokenPath = filePath;
            break;
          }
        }
      } catch {
        // Directory read failed - continue to return null
        return null;
      }
    }
  }

  if (!tokenPath) return null;

  try {
    const content = fs.readFileSync(tokenPath, 'utf8');
    const data: unknown = JSON.parse(content);

    // Validate CLIProxyAPI format with proper type checking
    if (isValidCliproxyToken(data)) {
      return {
        creds: mapCliproxyToGeminiCreds(data),
        sourcePath: tokenPath,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Read Gemini OAuth credentials
 * Priority: CLIProxy auth dir first, then ~/.gemini/oauth_creds.json
 * Returns credentials with source path for correct write-back
 */
function readGeminiCreds(accountId?: string): GeminiCredsWithSource | null {
  // 1. Try CLIProxy auth directory first (CCS-managed tokens)
  const cliproxyResult = readCliproxyGeminiCreds(accountId);
  if (cliproxyResult) {
    return cliproxyResult;
  }

  // Account-scoped refresh is only supported for CLIProxy account files.
  // Do not fall back to ~/.gemini for a specific accountId.
  if (accountId?.trim()) {
    return null;
  }

  // 2. Fall back to standard Gemini CLI location
  const oauthPath = getGeminiOAuthPath();
  if (!fs.existsSync(oauthPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(oauthPath, 'utf8');
    return {
      creds: JSON.parse(content) as GeminiOAuthCreds,
      sourcePath: oauthPath,
    };
  } catch {
    return null;
  }
}

/**
 * Write updated credentials to CLIProxy token file
 * Preserves existing fields (email, project_id), only updates token subfields
 */
function writeCliproxyGeminiCreds(tokenPath: string, creds: GeminiOAuthCreds): string | undefined {
  try {
    const existing = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const updated = {
      ...existing,
      token: {
        ...existing.token,
        access_token: creds.access_token,
        refresh_token: creds.refresh_token,
        expiry: creds.expiry_date,
      },
    };
    fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : 'Failed to write credentials';
  }
}

/**
 * Write Gemini OAuth credentials
 * Writes back to the specified source location (CLIProxy or ~/.gemini)
 * @param creds - The credentials to write
 * @param sourcePath - The path where credentials were originally read from
 * @returns error message if write failed, undefined on success
 */
function writeGeminiCreds(creds: GeminiOAuthCreds, sourcePath: string): string | undefined {
  const geminiOAuthPath = getGeminiOAuthPath();

  // If source is not the standard Gemini path, write to CLIProxy format
  if (sourcePath !== geminiOAuthPath) {
    return writeCliproxyGeminiCreds(sourcePath, creds);
  }

  // Otherwise write to standard Gemini CLI location
  const dir = path.dirname(geminiOAuthPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(geminiOAuthPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : 'Failed to write credentials';
  }
}

/**
 * Check if Gemini token is expired or expiring soon
 */
export function isGeminiTokenExpiringSoon(accountId?: string): boolean {
  const result = readGeminiCreds(accountId);
  if (!result || !result.creds.access_token) {
    return true; // No token = needs auth
  }
  if (!result.creds.expiry_date) {
    return false; // No expiry info = assume valid
  }
  const expiresIn = result.creds.expiry_date - Date.now();
  return expiresIn < REFRESH_LEAD_TIME_MS;
}

/**
 * Refresh Gemini access token using refresh_token
 * @param accountId Optional account ID for account-scoped refresh
 * @returns Result with success status, optional error, and expiry time
 */
export async function refreshGeminiToken(accountId?: string): Promise<{
  success: boolean;
  error?: string;
  expiresAt?: number;
}> {
  const result = readGeminiCreds(accountId);
  if (!result || !result.creds.refresh_token) {
    return { success: false, error: 'No refresh token available' };
  }

  const { creds, sourcePath } = result;
  const resolvedCredentials = resolveGeminiRefreshCredentials(creds);
  if (!resolvedCredentials.credentials) {
    return { success: false, error: resolvedCredentials.error };
  }

  const { clientId, clientSecret, tokenUrl } = resolvedCredentials.credentials;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refresh_token as string, // Already validated above
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    clearTimeout(timeoutId);

    const data = (await response.json()) as TokenRefreshResponse;

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error_description || data.error || `OAuth error: ${response.status}`,
      };
    }

    if (!data.access_token) {
      return { success: false, error: 'No access_token in response' };
    }

    // Update credentials file with new token
    const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    const updatedCreds: GeminiOAuthCreds = {
      ...creds,
      access_token: data.access_token,
      expiry_date: expiresAt,
    };
    const writeError = writeGeminiCreds(updatedCreds, sourcePath);
    if (writeError) {
      return { success: false, error: `Token refreshed but failed to save: ${writeError}` };
    }

    return { success: true, expiresAt };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Token refresh timeout' };
    }
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Ensure Gemini token is valid, refreshing if needed
 * @param verbose Log progress if true
 * @param accountId Optional account ID for account-scoped refresh
 * @returns true if token is valid (or was refreshed), false if refresh failed
 */
export async function ensureGeminiTokenValid(
  verbose = false,
  accountId?: string
): Promise<{
  valid: boolean;
  refreshed: boolean;
  error?: string;
}> {
  const result = readGeminiCreds(accountId);
  if (!result || !result.creds.access_token) {
    return { valid: false, refreshed: false, error: 'No Gemini credentials found' };
  }

  if (!isGeminiTokenExpiringSoon(accountId)) {
    return { valid: true, refreshed: false };
  }

  // Token is expired or expiring soon - try to refresh
  if (verbose) {
    console.log('[i] Gemini token expired or expiring soon, refreshing...');
  }

  const refreshResult = await refreshGeminiToken(accountId);
  if (refreshResult.success) {
    if (verbose) {
      console.log('[OK] Gemini token refreshed successfully');
    }
    return { valid: true, refreshed: true };
  }

  return { valid: false, refreshed: false, error: refreshResult.error };
}
