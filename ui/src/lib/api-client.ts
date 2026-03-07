/**
 * API Client
 * Phase 03: REST API Routes & CRUD
 */

import type { CLIProxyProvider } from './provider-config';

export const API_BASE_URL = '/api';
export const API_CONFLICT_ERROR_CODE = 'CONFLICT';

export class ApiConflictError extends Error {
  readonly code = API_CONFLICT_ERROR_CODE;

  constructor(message = 'Resource modified externally') {
    super(message);
    this.name = 'ApiConflictError';
  }
}

export function isApiConflictError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === API_CONFLICT_ERROR_CODE
  );
}

export function withApiBase(path: string): string {
  if (!path) {
    return API_BASE_URL;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (path === API_BASE_URL || path.startsWith(`${API_BASE_URL}/`)) {
    return path;
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseErrorMessage(response: Response): Promise<string> {
  const fallbackMessage = `Request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})`;
  const bodyText = await response.text();
  if (!bodyText) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(bodyText) as { error?: string; message?: string };
    if (parsed.error?.trim()) {
      return parsed.error;
    }
    if (parsed.message?.trim()) {
      return parsed.message;
    }
    return fallbackMessage;
  } catch {
    return bodyText.trim() || fallbackMessage;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(withApiBase(url), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }

  const bodyText = await res.text();
  if (!bodyText) {
    return undefined as T;
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return bodyText as T;
  }
}

// Types
export type CliTarget = 'claude' | 'droid';

export interface Profile {
  name: string;
  settingsPath: string;
  configured: boolean;
  target?: CliTarget;
}

export interface CreateProfile {
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  target?: CliTarget;
}

export interface UpdateProfile {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  target?: CliTarget;
}

export interface ProfileValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  field?: string;
  hint?: string;
}

export interface ProfileValidationSummary {
  valid: boolean;
  issues: ProfileValidationIssue[];
}

export interface ApiProfileOrphanCandidate {
  name: string;
  settingsPath: string;
  validation: ProfileValidationSummary;
}

export interface DiscoverProfileOrphansResponse {
  orphans: ApiProfileOrphanCandidate[];
}

export interface RegisterProfileOrphansRequest {
  names?: string[];
  target?: CliTarget;
  force?: boolean;
}

export interface RegisterProfileOrphansResponse {
  registered: string[];
  skipped: Array<{ name: string; reason: string }>;
}

export interface CopyProfileRequest {
  destination: string;
  target?: CliTarget;
  force?: boolean;
}

export interface CopyProfileResponse {
  success: boolean;
  name?: string;
  settingsPath?: string;
  warnings?: string[];
}

export interface ApiProfileExportBundle {
  schemaVersion: 1;
  exportedAt: string;
  profile: {
    name: string;
    target: CliTarget;
  };
  settings: Record<string, unknown>;
}

export interface ExportProfileResponse {
  success: boolean;
  bundle: ApiProfileExportBundle;
  redacted?: boolean;
}

export interface ImportProfileRequest {
  bundle: ApiProfileExportBundle;
  name?: string;
  target?: CliTarget;
  force?: boolean;
}

export interface ImportProfileResponse {
  success: boolean;
  name?: string;
  warnings?: string[];
  validation?: ProfileValidationSummary;
}

export interface Variant {
  name: string;
  provider: CLIProxyProvider;
  settings: string;
  account?: string;
  port?: number;
  model?: string;
  target?: CliTarget;
  type?: 'composite';
  default_tier?: 'opus' | 'sonnet' | 'haiku';
  tiers?: {
    opus: { provider: string; model: string; account?: string; thinking?: string };
    sonnet: { provider: string; model: string; account?: string; thinking?: string };
    haiku: { provider: string; model: string; account?: string; thinking?: string };
  };
}

export interface CreateVariant {
  name: string;
  provider: CLIProxyProvider;
  model?: string;
  account?: string;
  target?: CliTarget;
  type?: 'composite';
  default_tier?: 'opus' | 'sonnet' | 'haiku';
  tiers?: {
    opus: { provider: string; model: string; account?: string; thinking?: string };
    sonnet: { provider: string; model: string; account?: string; thinking?: string };
    haiku: { provider: string; model: string; account?: string; thinking?: string };
  };
}

export interface UpdateVariant {
  provider?: CLIProxyProvider;
  model?: string;
  account?: string;
  target?: CliTarget;
  type?: 'composite';
  default_tier?: 'opus' | 'sonnet' | 'haiku';
  tiers?: {
    opus: { provider: string; model: string; account?: string; thinking?: string };
    sonnet: { provider: string; model: string; account?: string; thinking?: string };
    haiku: { provider: string; model: string; account?: string; thinking?: string };
  };
}

/** OAuth account info for multi-account support */
export interface OAuthAccount {
  id: string;
  email?: string;
  nickname?: string;
  provider: CLIProxyProvider;
  isDefault: boolean;
  tokenFile: string;
  createdAt: string;
  lastUsedAt?: string;
  /** Whether account is paused (skipped in quota rotation) */
  paused?: boolean;
  /** ISO timestamp when account was paused */
  pausedAt?: string;
  /** Account tier: free, pro, ultra, or unknown */
  tier?: 'free' | 'pro' | 'ultra' | 'unknown';
  /** GCP Project ID (Antigravity only) - read-only */
  projectId?: string;
}

export interface AuthStatus {
  provider: string;
  displayName: string;
  authenticated: boolean;
  lastAuth: string | null;
  tokenFiles: number;
  accounts: OAuthAccount[];
  defaultAccount?: string;
}

/** Auth file info for Config tab */
export interface AuthFile {
  name: string;
  provider?: string;
}

/** CLIProxy model from /v1/models endpoint */
export interface CliproxyModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

/** Categorized models response from CLIProxyAPI */
export interface CliproxyModelsResponse {
  models: CliproxyModel[];
  byCategory: Record<string, CliproxyModel[]>;
  totalCount: number;
}

/** Individual model quota info from Google Cloud Code API */
export interface ModelQuota {
  /** Model name, e.g., "gemini-3-pro-high" */
  name: string;
  /** Display name from API, e.g., "Gemini 3 Pro" */
  displayName?: string;
  /** Remaining quota as percentage (0-100) */
  percentage: number;
  /** ISO timestamp when quota resets, null if unknown */
  resetTime: string | null;
}

/** Quota fetch result */
export interface QuotaResult {
  /** Whether fetch succeeded */
  success: boolean;
  /** Quota for each available model */
  models: ModelQuota[];
  /** Timestamp of fetch */
  lastUpdated: number;
  /** Upstream HTTP status when available */
  httpStatus?: number;
  /** Stable machine-readable error code */
  errorCode?: string;
  /** Additional provider-specific detail/code from upstream */
  errorDetail?: string;
  /** True if account lacks quota access (403) */
  isForbidden?: boolean;
  /** Error message if fetch failed */
  error?: string;
  /** Provider-specific remediation guidance */
  actionHint?: string;
  /** True when the failure is temporary and retrying later may help */
  retryable?: boolean;
  /** True if token is expired and needs re-authentication */
  needsReauth?: boolean;
}

/** Codex rate limit window */
export interface CodexQuotaWindow {
  /** Window label: "Primary", "Secondary", "Code Review (Primary)", "Code Review (Secondary)" */
  label: string;
  /** Percentage used (0-100) */
  usedPercent: number;
  /** Percentage remaining (100 - usedPercent) */
  remainingPercent: number;
  /** Seconds until quota resets, null if unknown */
  resetAfterSeconds: number | null;
  /** ISO timestamp when quota resets, null if unknown */
  resetAt: string | null;
}

/** Core Codex usage window (5h/weekly) extracted from raw windows */
export interface CodexCoreUsageWindow {
  /** Source window label */
  label: string;
  /** Percentage remaining (0-100) */
  remainingPercent: number;
  /** Seconds until quota resets, null if unknown */
  resetAfterSeconds: number | null;
  /** ISO timestamp when quota resets, null if unknown */
  resetAt: string | null;
}

/** Core Codex usage summary with explicit 5h and weekly windows */
export interface CodexCoreUsageSummary {
  /** Short-cycle usage limit window (typically 5h) */
  fiveHour: CodexCoreUsageWindow | null;
  /** Long-cycle usage limit window (typically weekly) */
  weekly: CodexCoreUsageWindow | null;
}

/** Codex quota result */
export interface CodexQuotaResult {
  /** Whether fetch succeeded */
  success: boolean;
  /** Quota windows (primary, secondary, code review) */
  windows: CodexQuotaWindow[];
  /** Explicit core usage windows (5h + weekly) for easier reset display */
  coreUsage?: CodexCoreUsageSummary;
  /** Plan type: free, plus, team, or null if unknown */
  planType: 'free' | 'plus' | 'team' | null;
  /** Timestamp of fetch */
  lastUpdated: number;
  /** Upstream HTTP status when available */
  httpStatus?: number;
  /** Stable machine-readable error code */
  errorCode?: string;
  /** Additional provider-specific detail/code from upstream */
  errorDetail?: string;
  /** Error message if fetch failed */
  error?: string;
  /** Account ID (email) this quota belongs to */
  accountId?: string;
  /** Provider-specific remediation guidance */
  actionHint?: string;
  /** True if token is expired and needs re-authentication */
  needsReauth?: boolean;
  /** True when the failure is temporary and retrying later may help */
  retryable?: boolean;
  /** True if result was served from cache */
  cached?: boolean;
  /** True if account lacks quota access (403) - displayed as 0% instead of error */
  isForbidden?: boolean;
}

/** Claude policy limit window */
export interface ClaudeQuotaWindow {
  /** Source identifier: five_hour, seven_day, seven_day_opus, seven_day_sonnet, overage, ... */
  rateLimitType: string;
  /** Human-friendly label for UI display */
  label: string;
  /** Upstream status: allowed, allowed_warning, rejected */
  status: string;
  /** Utilization ratio (0-1) when available */
  utilization: number | null;
  /** Utilization as percentage (0-100) */
  usedPercent: number;
  /** Remaining percentage (100 - usedPercent) */
  remainingPercent: number;
  /** Reset timestamp for this window, null if unknown */
  resetAt: string | null;
  surpassedThreshold?: boolean;
  severity?: string;
  overageStatus?: string;
  overageResetsAt?: string | null;
  overageDisabledReason?: string | null;
  isUsingOverage?: boolean;
  hasExtraUsageEnabled?: boolean;
}

/** Core Claude usage window (5h/weekly) */
export interface ClaudeCoreUsageWindow {
  rateLimitType: string;
  label: string;
  remainingPercent: number;
  resetAt: string | null;
  status: string;
}

/** Core Claude usage summary (5h + weekly) */
export interface ClaudeCoreUsageSummary {
  fiveHour: ClaudeCoreUsageWindow | null;
  weekly: ClaudeCoreUsageWindow | null;
}

/** Claude quota result */
export interface ClaudeQuotaResult {
  success: boolean;
  windows: ClaudeQuotaWindow[];
  coreUsage?: ClaudeCoreUsageSummary;
  lastUpdated: number;
  httpStatus?: number;
  errorCode?: string;
  errorDetail?: string;
  isForbidden?: boolean;
  error?: string;
  accountId?: string;
  actionHint?: string;
  needsReauth?: boolean;
  retryable?: boolean;
  /** True if result was served from cache */
  cached?: boolean;
}

/** Gemini CLI bucket (grouped by model series) */
export interface GeminiCliBucket {
  /** Unique bucket identifier (e.g., "gemini-flash-series::input") */
  id: string;
  /** Display label (e.g., "Gemini Flash Series") */
  label: string;
  /** Token type: "input", "output", or null if combined */
  tokenType: string | null;
  /** Remaining quota as fraction (0-1) */
  remainingFraction: number;
  /** Remaining quota as percentage (0-100) */
  remainingPercent: number;
  /** ISO timestamp when quota resets, null if unknown */
  resetTime: string | null;
  /** Model IDs in this bucket */
  modelIds: string[];
}

/** Gemini CLI quota result */
export interface GeminiCliQuotaResult {
  /** Whether fetch succeeded */
  success: boolean;
  /** Quota buckets grouped by model series */
  buckets: GeminiCliBucket[];
  /** GCP project ID for this account */
  projectId: string | null;
  /** Timestamp of fetch */
  lastUpdated: number;
  /** Upstream HTTP status when available */
  httpStatus?: number;
  /** Stable machine-readable error code */
  errorCode?: string;
  /** Additional provider-specific detail/code from upstream */
  errorDetail?: string;
  /** True if account lacks quota access (403) */
  isForbidden?: boolean;
  /** Error message if fetch failed */
  error?: string;
  /** Account ID (email) this quota belongs to */
  accountId?: string;
  /** Provider-specific remediation guidance */
  actionHint?: string;
  /** True if token is expired and needs re-authentication */
  needsReauth?: boolean;
  /** True when the failure is temporary and retrying later may help */
  retryable?: boolean;
  /** True if result was served from cache */
  cached?: boolean;
}

/** GitHub Copilot quota snapshot */
export interface GhcpQuotaSnapshot {
  /** Total quota allocation for this category */
  entitlement: number;
  /** Remaining quota count */
  remaining: number;
  /** Used quota count */
  used: number;
  /** Remaining quota percentage (0-100) */
  percentRemaining: number;
  /** Used quota percentage (0-100) */
  percentUsed: number;
  /** Whether this quota category is unlimited */
  unlimited: boolean;
  /** Overage usage count */
  overageCount: number;
  /** Whether overage is permitted */
  overagePermitted: boolean;
  /** Upstream quota identifier if available */
  quotaId: string | null;
}

/** GitHub Copilot (ghcp) quota result */
export interface GhcpQuotaResult {
  /** Whether fetch succeeded */
  success: boolean;
  /** Copilot plan type */
  planType: string | null;
  /** Quota reset date/time */
  quotaResetDate: string | null;
  snapshots: {
    premiumInteractions: GhcpQuotaSnapshot;
    chat: GhcpQuotaSnapshot;
    completions: GhcpQuotaSnapshot;
  };
  /** Timestamp of fetch */
  lastUpdated: number;
  /** Upstream HTTP status when available */
  httpStatus?: number;
  /** Stable machine-readable error code */
  errorCode?: string;
  /** Additional provider-specific detail/code from upstream */
  errorDetail?: string;
  /** True if account lacks quota access (403) */
  isForbidden?: boolean;
  /** Error message if fetch failed */
  error?: string;
  /** Account ID this quota belongs to */
  accountId?: string;
  /** Provider-specific remediation guidance */
  actionHint?: string;
  /** True if token is expired and needs re-authentication */
  needsReauth?: boolean;
  /** True when the failure is temporary and retrying later may help */
  retryable?: boolean;
  /** True if result was served from cache */
  cached?: boolean;
}

/** Provider accounts summary */
export type ProviderAccountsMap = Record<string, OAuthAccount[]>;

export interface Account {
  name: string;
  type?: string;
  created: string;
  last_used?: string | null;
  context_mode?: 'isolated' | 'shared';
  context_group?: string;
  continuity_mode?: 'standard' | 'deeper';
  context_inferred?: boolean;
  continuity_inferred?: boolean;
  provider?: string;
  displayName?: string;
}

export interface UpdateAccountContext {
  context_mode: 'isolated' | 'shared';
  context_group?: string;
  continuity_mode?: 'standard' | 'deeper';
}

// Unified config types
export interface ConfigFormat {
  format: 'yaml' | 'json' | 'none';
  migrationNeeded: boolean;
  backups: string[];
}

export interface MigrationResult {
  success: boolean;
  backupPath?: string;
  error?: string;
  migratedFiles: string[];
  warnings: string[];
}

/** Model preset for quick model switching */
export interface ModelPreset {
  name: string;
  default: string;
  opus: string;
  sonnet: string;
  haiku: string;
}

export interface CreatePreset {
  name: string;
  default: string;
  opus?: string;
  sonnet?: string;
  haiku?: string;
}

/** Remote proxy status from health check */
export interface RemoteProxyStatus {
  reachable: boolean;
  latencyMs?: number;
  error?: string;
  errorCode?: 'CONNECTION_REFUSED' | 'TIMEOUT' | 'AUTH_FAILED' | 'UNKNOWN';
}

/** Remote proxy configuration */
export interface ProxyRemoteConfig {
  enabled: boolean;
  host: string;
  /** Port is optional - uses protocol default (443 for HTTPS, 80 for HTTP) */
  port?: number;
  protocol: 'http' | 'https';
  auth_token: string;
  /** Management key for /v0/management/* endpoints (optional, falls back to auth_token) */
  management_key?: string;
}

/** Fallback configuration */
export interface ProxyFallbackConfig {
  enabled: boolean;
  auto_start: boolean;
}

/** Local proxy configuration */
export interface ProxyLocalConfig {
  port: number;
  auto_start: boolean;
}

/** CLIProxy server configuration */
export interface CliproxyServerConfig {
  remote: ProxyRemoteConfig;
  fallback: ProxyFallbackConfig;
  local: ProxyLocalConfig;
}

/** CLIProxy process status from session tracker */
export interface ProxyProcessStatus {
  running: boolean;
  port?: number;
  pid?: number;
  sessionCount?: number;
  startedAt?: string;
}

/** Error log file metadata from CLIProxyAPI */
export interface CliproxyErrorLog {
  /** Filename (e.g., "error-v1-chat-completions-2025-01-15T10-30-00.log") */
  name: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp (Unix seconds) */
  modified: number;
}

/** Result from starting proxy service */
export interface ProxyStartResult {
  started: boolean;
  alreadyRunning: boolean;
  port: number;
  configRegenerated?: boolean;
  error?: string;
}

/** Result from stopping proxy service */
export interface ProxyStopResult {
  stopped: boolean;
  pid?: number;
  sessionCount?: number;
  error?: string;
}

/** Result from checking for CLIProxyAPI updates */
export interface CliproxyUpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  fromCache: boolean;
  checkedAt: number; // Unix timestamp of last check
  // Backend info
  backend: 'original' | 'plus';
  backendLabel: string;
  // Stability fields
  isStable: boolean; // Whether current version is at or below max stable
  maxStableVersion: string; // Maximum stable version (e.g., "6.6.80")
  stabilityMessage?: string; // Warning message if running unstable version
}

/** Available versions list from GitHub releases */
export interface CliproxyVersionsResponse {
  versions: string[];
  latestStable: string;
  latest: string;
  currentVersion: string;
  maxStableVersion: string;
  faultyRange?: {
    min: string;
    max: string;
  };
  fromCache: boolean;
  checkedAt: number;
}

/** Result from installing a specific version */
export interface CliproxyInstallResult {
  success: boolean;
  version?: string;
  restarted?: boolean;
  port?: number;
  isFaulty?: boolean;
  isExperimental?: boolean;
  requiresConfirmation?: boolean;
  message?: string;
  error?: string;
}

/** Result from restarting the proxy */
export interface CliproxyRestartResult {
  success: boolean;
  port?: number;
  error?: string;
}

// API
export const api = {
  profiles: {
    list: () => request<{ profiles: Profile[] }>('/profiles'),
    create: (data: CreateProfile) =>
      request('/profiles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (name: string, data: UpdateProfile) =>
      request(`/profiles/${name}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (name: string) => request(`/profiles/${name}`, { method: 'DELETE' }),
    discoverOrphans: () => request<DiscoverProfileOrphansResponse>('/profiles/orphans'),
    registerOrphans: (data: RegisterProfileOrphansRequest) =>
      request<RegisterProfileOrphansResponse>('/profiles/orphans/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    copy: (name: string, data: CopyProfileRequest) =>
      request<CopyProfileResponse>(`/profiles/${name}/copy`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    export: (name: string, includeSecrets = false) =>
      request<ExportProfileResponse>(`/profiles/${name}/export`, {
        method: 'POST',
        body: JSON.stringify({ includeSecrets }),
      }),
    import: (data: ImportProfileRequest) =>
      request<ImportProfileResponse>('/profiles/import', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  cliproxy: {
    list: () => request<{ variants: Variant[] }>('/cliproxy'),
    getAuthStatus: () =>
      request<{ authStatus: AuthStatus[]; source?: 'remote' | 'local'; error?: string }>(
        '/cliproxy/auth'
      ),
    create: (data: CreateVariant) =>
      request('/cliproxy', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (name: string, data: UpdateVariant) =>
      request(`/cliproxy/${name}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (name: string) => request(`/cliproxy/${name}`, { method: 'DELETE' }),

    // Proxy process status and control
    proxyStatus: () => request<ProxyProcessStatus>('/cliproxy/proxy-status'),
    proxyStart: () => request<ProxyStartResult>('/cliproxy/proxy-start', { method: 'POST' }),
    proxyStop: () => request<ProxyStopResult>('/cliproxy/proxy-stop', { method: 'POST' }),
    updateCheck: () => request<CliproxyUpdateCheckResult>('/cliproxy/update-check'),

    // Version management
    versions: () => request<CliproxyVersionsResponse>('/cliproxy/versions'),
    install: (version: string, force?: boolean) =>
      request<CliproxyInstallResult>('/cliproxy/install', {
        method: 'POST',
        body: JSON.stringify({ version, force }),
      }),
    restart: () => request<CliproxyRestartResult>('/cliproxy/restart', { method: 'POST' }),

    // Stats and models for Overview tab
    stats: () => request<{ usage: Record<string, unknown> }>('/cliproxy/usage'),
    models: () => request<CliproxyModelsResponse>('/cliproxy/models'),
    updateModel: (provider: string, model: string) =>
      request(`/cliproxy/models/${provider}`, {
        method: 'PUT',
        body: JSON.stringify({ model }),
      }),

    // Config YAML for Config tab
    getConfigYaml: async (): Promise<string> => {
      const res = await fetch(withApiBase('/cliproxy/config.yaml'));
      if (!res.ok) throw new Error('Failed to load config');
      return res.text();
    },
    saveConfigYaml: async (content: string): Promise<void> => {
      const res = await fetch(withApiBase('/cliproxy/config.yaml'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/yaml' },
        body: content,
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Failed to save config' }));
        throw new Error(error.error || 'Failed to save config');
      }
    },

    // Auth files for Config tab
    getAuthFiles: () => request<{ files: AuthFile[] }>('/cliproxy/auth-files'),
    getAuthFile: async (name: string): Promise<string> => {
      const res = await fetch(
        withApiBase(`/cliproxy/auth-files/download?name=${encodeURIComponent(name)}`)
      );
      if (!res.ok) throw new Error('Failed to load auth file');
      return res.text();
    },

    // Multi-account management
    accounts: {
      list: () => request<{ accounts: ProviderAccountsMap }>('/cliproxy/auth/accounts'),
      listByProvider: (provider: string) =>
        request<{ provider: string; accounts: OAuthAccount[] }>(
          `/cliproxy/auth/accounts/${provider}`
        ),
      setDefault: (provider: string, accountId: string) =>
        request(`/cliproxy/auth/accounts/${provider}/default`, {
          method: 'POST',
          body: JSON.stringify({ accountId }),
        }),
      remove: (provider: string, accountId: string) =>
        request(`/cliproxy/auth/accounts/${provider}/${accountId}`, { method: 'DELETE' }),
      pause: (provider: string, accountId: string) =>
        request<{ provider: string; accountId: string; paused: boolean }>(
          `/cliproxy/auth/accounts/${provider}/${accountId}/pause`,
          { method: 'POST' }
        ),
      resume: (provider: string, accountId: string) =>
        request<{ provider: string; accountId: string; paused: boolean }>(
          `/cliproxy/auth/accounts/${provider}/${accountId}/resume`,
          { method: 'POST' }
        ),
      /** Solo mode: activate one account, pause all others */
      solo: (provider: string, accountId: string) =>
        request<{ activated: string; paused: string[] }>('/accounts/solo', {
          method: 'POST',
          body: JSON.stringify({ provider, accountId }),
        }),
      /** Bulk pause multiple accounts */
      bulkPause: (provider: string, accountIds: string[]) =>
        request<{ succeeded: string[]; failed: Array<{ id: string; reason: string }> }>(
          '/accounts/bulk-pause',
          {
            method: 'POST',
            body: JSON.stringify({ provider, accountIds }),
          }
        ),
      /** Bulk resume multiple accounts */
      bulkResume: (provider: string, accountIds: string[]) =>
        request<{ succeeded: string[]; failed: Array<{ id: string; reason: string }> }>(
          '/accounts/bulk-resume',
          {
            method: 'POST',
            body: JSON.stringify({ provider, accountIds }),
          }
        ),
    },
    // OAuth flow
    auth: {
      /** Start OAuth flow - opens browser for authentication */
      start: (provider: string, nickname?: string) =>
        request<{ success: boolean; account: OAuthAccount }>(`/cliproxy/auth/${provider}/start`, {
          method: 'POST',
          body: JSON.stringify({ nickname }),
        }),
      /** Cancel in-progress OAuth flow */
      cancel: (provider: string) =>
        request<{ success: boolean; cancelled: number; provider: string }>(
          `/cliproxy/auth/${provider}/cancel`,
          { method: 'POST' }
        ),
      /** Import Kiro token from Kiro IDE (Kiro only) */
      kiroImport: () =>
        request<{ success: boolean; account: OAuthAccount | null; error?: string }>(
          '/cliproxy/auth/kiro/import',
          { method: 'POST' }
        ),
    },
    // Error logs
    errorLogs: {
      /** List error log files */
      list: () => request<{ files: CliproxyErrorLog[] }>('/cliproxy/error-logs'),
      /** Get content of a specific error log */
      getContent: async (name: string): Promise<string> => {
        const res = await fetch(withApiBase(`/cliproxy/error-logs/${encodeURIComponent(name)}`));
        if (!res.ok) throw new Error('Failed to load error log');
        return res.text();
      },
    },
  },
  accounts: {
    list: () => request<{ accounts: Account[]; default: string | null }>('/accounts'),
    setDefault: (name: string) =>
      request('/accounts/default', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    resetDefault: () => request('/accounts/reset-default', { method: 'DELETE' }),
    delete: (name: string) => request(`/accounts/${name}`, { method: 'DELETE' }),
    updateContext: (name: string, data: UpdateAccountContext) =>
      request(`/accounts/${encodeURIComponent(name)}/context`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },
  // Unified config API
  config: {
    format: () => request<ConfigFormat>('/config/format'),
    get: () => request<Record<string, unknown>>('/config'),
    update: (config: Record<string, unknown>) =>
      request<{ success: boolean }>('/config', {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    migrate: (dryRun = false) =>
      request<MigrationResult>(`/config/migrate?dryRun=${dryRun}`, { method: 'POST' }),
    rollback: (backupPath: string) =>
      request<{ success: boolean }>('/config/rollback', {
        method: 'POST',
        body: JSON.stringify({ backupPath }),
      }),
  },
  /** Model presets for quick model switching */
  presets: {
    list: (profile: string) => request<{ presets: ModelPreset[] }>(`/settings/${profile}/presets`),
    create: (profile: string, data: CreatePreset) =>
      request<{ preset: ModelPreset }>(`/settings/${profile}/presets`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (profile: string, name: string) =>
      request<{ success: boolean }>(`/settings/${profile}/presets/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
  },
  /** CLIProxy server configuration API */
  cliproxyServer: {
    /** Get cliproxy server configuration */
    get: () => request<CliproxyServerConfig>('/cliproxy-server'),
    /** Update cliproxy server configuration */
    update: (config: Partial<CliproxyServerConfig>) =>
      request<CliproxyServerConfig>('/cliproxy-server', {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    /** Get backend setting */
    getBackend: () => request<{ backend: 'original' | 'plus' }>('/cliproxy-server/backend'),
    /** Update backend setting */
    updateBackend: (backend: 'original' | 'plus', force = false) =>
      request<{ backend: 'original' | 'plus' }>('/cliproxy-server/backend', {
        method: 'PUT',
        body: JSON.stringify({ backend, force }),
      }),
    /** Test remote proxy connection */
    test: (params: {
      host: string;
      /** Port is optional - uses protocol default (443 for HTTPS, 80 for HTTP) */
      port?: number;
      protocol: 'http' | 'https';
      authToken?: string;
      allowSelfSigned?: boolean;
    }) =>
      request<RemoteProxyStatus>('/cliproxy-server/test', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  },
  /** Account quota API */
  quota: {
    /** Fetch quota for a specific account */
    get: (provider: string, accountId: string) =>
      request<QuotaResult>(`/cliproxy/quota/${provider}/${encodeURIComponent(accountId)}`),
    /** Fetch Codex quota for a specific account */
    getCodex: (accountId: string) =>
      request<CodexQuotaResult>(`/cliproxy/quota/codex/${encodeURIComponent(accountId)}`),
    /** Fetch Claude quota for a specific account */
    getClaude: (accountId: string) =>
      request<ClaudeQuotaResult>(`/cliproxy/quota/claude/${encodeURIComponent(accountId)}`),
    /** Fetch Gemini CLI quota for a specific account */
    getGemini: (accountId: string) =>
      request<GeminiCliQuotaResult>(`/cliproxy/quota/gemini/${encodeURIComponent(accountId)}`),
  },
};
