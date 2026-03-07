/**
 * Auth Types and Configurations
 *
 * Type definitions and OAuth configurations for CLIProxy authentication.
 */

import { CLIProxyProvider } from '../types';
import type { AccountInfo } from '../account-manager';
import {
  buildProviderMap,
  CLIPROXY_PROVIDER_IDS,
  getOAuthCallbackPort,
  getCLIProxyCallbackProviderName,
  getCLIProxyAuthUrlProviderName,
  getProviderAuthFilePrefixes,
  getProviderTokenTypeValues,
} from '../provider-capabilities';

/**
 * Kiro authentication methods supported by CLIProxyAPIPlus.
 * - aws: AWS Builder ID via Device Code flow
 * - aws-authcode: AWS Builder ID via Authorization Code flow (CLI flag only)
 * - google: Social OAuth via Google
 * - github: Social OAuth via GitHub (management API only)
 */
export const KIRO_AUTH_METHODS = ['aws', 'aws-authcode', 'google', 'github'] as const;
export type KiroAuthMethod = (typeof KIRO_AUTH_METHODS)[number];

/** CLI binary supports these Kiro methods directly via flags. */
export const KIRO_CLI_AUTH_METHODS = ['aws', 'aws-authcode', 'google'] as const;
export type KiroCLIAuthMethod = (typeof KIRO_CLI_AUTH_METHODS)[number];

/** Default Kiro method for CCS UX and AWS Organization support. */
export const DEFAULT_KIRO_AUTH_METHOD: KiroAuthMethod = 'aws';

export function isKiroAuthMethod(value: string): value is KiroAuthMethod {
  return KIRO_AUTH_METHODS.includes(value as KiroAuthMethod);
}

export function isKiroCLIAuthMethod(value: string): value is KiroCLIAuthMethod {
  return KIRO_CLI_AUTH_METHODS.includes(value as KiroCLIAuthMethod);
}

export function normalizeKiroAuthMethod(value?: string): KiroAuthMethod {
  if (!value) return DEFAULT_KIRO_AUTH_METHOD;
  const normalized = value.trim().toLowerCase();
  return isKiroAuthMethod(normalized) ? normalized : DEFAULT_KIRO_AUTH_METHOD;
}

export function isKiroDeviceCodeMethod(method: KiroAuthMethod): boolean {
  return method === 'aws';
}

export function getKiroCallbackPort(method: KiroAuthMethod): number | null {
  return isKiroDeviceCodeMethod(method) ? null : 9876;
}

export function getKiroCLIAuthFlag(method: KiroCLIAuthMethod): string {
  switch (method) {
    case 'aws':
      return '--kiro-aws-login';
    case 'aws-authcode':
      return '--kiro-aws-authcode';
    case 'google':
      return '--kiro-google-login';
  }
}

/**
 * Kiro method for CLIProxyAPI management endpoint:
 * GET /v0/management/kiro-auth-url?method=<value>
 */
export function toKiroManagementMethod(method: KiroAuthMethod): 'aws' | 'google' | 'github' {
  switch (method) {
    case 'google':
      return 'google';
    case 'github':
      return 'github';
    case 'aws-authcode':
      return 'aws';
    case 'aws':
    default:
      return 'aws';
  }
}

/**
 * OAuth callback ports used by CLIProxyAPI (hardcoded in binary)
 * See: https://github.com/router-for-me/CLIProxyAPI/tree/main/internal/auth
 *
 * OAuth flow types per provider:
 * - Gemini: Authorization Code Flow with local callback server on port 8085
 * - Codex:  Authorization Code Flow with local callback server on port 1455
 * - Agy:    Authorization Code Flow with local callback server on port 51121
 * - iFlow:  Authorization Code Flow with local callback server on port 11451
 * - Claude: Authorization Code Flow with local callback server on port 54545 (Anthropic OAuth)
 * - Kiro:   Device Code Flow (polling-based, NO callback port needed)
 * - Qwen:   Device Code Flow (polling-based, NO callback port needed)
 * - GHCP:   Device Code Flow (polling-based, NO callback port needed)
 * - Kimi:   Device Code Flow (polling-based, NO callback port needed)
 */
export const OAUTH_CALLBACK_PORTS: Partial<Record<CLIProxyProvider, number>> =
  CLIPROXY_PROVIDER_IDS.reduce(
    (acc, provider) => {
      const callbackPort = getOAuthCallbackPort(provider);
      if (callbackPort !== null) {
        acc[provider] = callbackPort;
      }
      return acc;
    },
    {} as Partial<Record<CLIProxyProvider, number>>
  );

/**
 * Auth status for a provider
 */
export interface AuthStatus {
  /** Provider name */
  provider: CLIProxyProvider;
  /** Whether authentication exists */
  authenticated: boolean;
  /** Path to token directory */
  tokenDir: string;
  /** Token file paths found */
  tokenFiles: string[];
  /** When last authenticated (if known) */
  lastAuth?: Date;
  /** Accounts registered for this provider (multi-account support) */
  accounts: AccountInfo[];
  /** Default account ID */
  defaultAccount?: string;
}

/**
 * OAuth config for each provider
 */
export interface ProviderOAuthConfig {
  /** Provider identifier */
  provider: CLIProxyProvider;
  /** Display name */
  displayName: string;
  /** OAuth authorization URL (for manual flow) */
  authUrl: string;
  /** Scopes required */
  scopes: string[];
  /** CLI flag for auth */
  authFlag: string;
}

/**
 * OAuth configurations per provider
 * Note: CLIProxyAPI handles actual OAuth - these are for display/manual flow
 */
export const OAUTH_CONFIGS: Record<CLIProxyProvider, ProviderOAuthConfig> = {
  gemini: {
    provider: 'gemini',
    displayName: 'Google Gemini',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: ['https://www.googleapis.com/auth/generative-language'],
    authFlag: '--login',
  },
  codex: {
    provider: 'codex',
    displayName: 'Codex',
    authUrl: 'https://auth.openai.com/authorize',
    scopes: ['openid', 'profile'],
    authFlag: '--codex-login',
  },
  agy: {
    provider: 'agy',
    displayName: 'Antigravity',
    authUrl: 'https://antigravity.ai/oauth/authorize',
    scopes: ['api'],
    authFlag: '--antigravity-login',
  },
  qwen: {
    provider: 'qwen',
    displayName: 'Qwen Code',
    authUrl: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
    scopes: ['openid', 'profile', 'email', 'model.completion'],
    authFlag: '--qwen-login',
  },
  iflow: {
    provider: 'iflow',
    displayName: 'iFlow',
    authUrl: 'https://iflow.cn/oauth',
    scopes: ['phone', 'profile', 'email'],
    authFlag: '--iflow-login',
  },
  kiro: {
    provider: 'kiro',
    displayName: 'Kiro (AWS)',
    authUrl: 'https://oidc.us-east-1.amazonaws.com',
    scopes: ['codewhisperer:completions', 'codewhisperer:conversations'],
    // Default to AWS Builder ID device code flow for better compatibility.
    // Other Kiro methods are selected at runtime via OAuthOptions.kiroMethod.
    authFlag: '--kiro-aws-login',
  },
  ghcp: {
    provider: 'ghcp',
    displayName: 'GitHub Copilot (OAuth)',
    authUrl: 'https://github.com/login/device/code',
    scopes: ['copilot'],
    authFlag: '--github-copilot-login',
  },
  claude: {
    provider: 'claude',
    displayName: 'Claude (Anthropic)',
    authUrl: 'https://console.anthropic.com/oauth/authorize',
    scopes: ['user:inference', 'user:profile'],
    authFlag: '--claude-login',
  },
  kimi: {
    provider: 'kimi',
    displayName: 'Kimi (Moonshot)',
    authUrl: 'https://auth.kimi.com/api/oauth/device_authorization',
    scopes: ['api'],
    authFlag: '--kimi-login',
  },
};

/**
 * Provider-specific auth file prefixes (fallback detection)
 * CLIProxyAPI names auth files with provider prefix (e.g., "antigravity-user@email.json")
 * Note: Gemini tokens may NOT have prefix - CLIProxyAPI uses {email}-{projectID}.json format
 */
export const PROVIDER_AUTH_PREFIXES: Record<CLIProxyProvider, string[]> = buildProviderMap(
  (provider) => [...getProviderAuthFilePrefixes(provider)]
);

/**
 * Provider type values inside token JSON files
 * CLIProxyAPI sets "type" field in token JSON (e.g., {"type": "gemini"})
 */
export const PROVIDER_TYPE_VALUES: Record<CLIProxyProvider, string[]> = buildProviderMap(
  (provider) => [...getProviderTokenTypeValues(provider)]
);

/**
 * Maps CCS provider names to CLIProxyAPI callback provider names
 * Used when submitting OAuth callbacks to CLIProxyAPI management endpoint
 */
export const CLIPROXY_CALLBACK_PROVIDER_MAP: Record<CLIProxyProvider, string> = buildProviderMap(
  (provider) => getCLIProxyCallbackProviderName(provider)
);

/**
 * Maps CCS provider names to CLIProxyAPI auth-url endpoint prefixes.
 * Used for GET /v0/management/${prefix}-auth-url endpoints.
 * These differ from callback names for some providers (e.g., gemini-cli vs gemini).
 */
export const CLIPROXY_AUTH_URL_PROVIDER_MAP: Record<CLIProxyProvider, string> = buildProviderMap(
  (provider) => getCLIProxyAuthUrlProviderName(provider)
);

export function getManagementAuthUrlPath(provider: CLIProxyProvider): string {
  const authUrlProvider = CLIPROXY_AUTH_URL_PROVIDER_MAP[provider] || provider;
  return `/v0/management/${authUrlProvider}-auth-url?is_webui=true`;
}

export function getPasteCallbackStartPath(provider: CLIProxyProvider): string {
  // Kiro CLI auth methods still use the legacy start route.
  if (provider === 'kiro') {
    return `/oauth/${provider}/start`;
  }
  return getManagementAuthUrlPath(provider);
}

export function getManagementOAuthCallbackPath(): string {
  return '/v0/management/oauth-callback';
}

/**
 * Get OAuth config for provider
 */
export function getOAuthConfig(provider: CLIProxyProvider): ProviderOAuthConfig {
  const config = OAUTH_CONFIGS[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return config;
}

/**
 * OAuth options for triggerOAuth
 */
export interface OAuthOptions {
  verbose?: boolean;
  headless?: boolean;
  account?: string;
  add?: boolean;
  nickname?: string;
  /** If true, caller explicitly accepts Antigravity OAuth risk for this command/session. */
  acceptAgyRisk?: boolean;
  /** Kiro auth method override (CLI + Dashboard parity). */
  kiroMethod?: KiroAuthMethod;
  /** If true, triggered from Web UI (enables project selection prompt) */
  fromUI?: boolean;
  /** If true, use --no-incognito flag (Kiro only - use normal browser instead of incognito) */
  noIncognito?: boolean;
  /** If true, skip OAuth and import token from Kiro IDE directly (Kiro only) */
  import?: boolean;
  /** Enable paste-callback mode: show auth URL and prompt for callback paste */
  pasteCallback?: boolean;
  /** If true, use port-forwarding mode (skip interactive prompt in headless) */
  portForward?: boolean;
}
