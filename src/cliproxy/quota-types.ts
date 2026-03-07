/**
 * Shared Quota Type Definitions
 *
 * Unified types for multi-provider quota system.
 * Supports Antigravity, Codex, Claude, Gemini CLI, and GitHub Copilot OAuth providers.
 */

/** Supported quota providers */
export type QuotaProvider = 'agy' | 'codex' | 'claude' | 'gemini' | 'ghcp';

// Re-export Antigravity types for unified access
export type { QuotaResult as AntigravityQuotaResult } from './quota-fetcher';

export interface QuotaErrorMetadata {
  /** Upstream HTTP status when available */
  httpStatus?: number;
  /** Stable machine-readable error code */
  errorCode?: string;
  /** Additional provider-specific detail/code from upstream */
  errorDetail?: string;
  /** True if account lacks quota access (403) */
  isForbidden?: boolean;
  /** Provider-specific remediation guidance */
  actionHint?: string;
  /** True when the failure is temporary and retrying later may help */
  retryable?: boolean;
}

/**
 * Codex quota window (primary, secondary, code review)
 */
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

/**
 * Codex quota fetch result
 */
export interface CodexQuotaResult extends QuotaErrorMetadata {
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
  /** Error message if fetch failed */
  error?: string;
  /** Account ID (email) this quota belongs to */
  accountId?: string;
  /** True if token is expired and needs re-authentication */
  needsReauth?: boolean;
  /** True if account lacks quota access (403) - displayed as 0% instead of error */
  isForbidden?: boolean;
}

/**
 * Claude policy limit window (5h/weekly/overage)
 */
export interface ClaudeQuotaWindow {
  /** Source identifier: five_hour, seven_day, seven_day_opus, seven_day_sonnet, overage, ... */
  rateLimitType: string;
  /** Human-friendly label for UI/CLI display */
  label: string;
  /** Upstream status: allowed, allowed_warning, rejected */
  status: string;
  /** Utilization ratio (0-1) reported by API; null when unavailable */
  utilization: number | null;
  /** Utilization as percentage (0-100) */
  usedPercent: number;
  /** Remaining percentage (100 - usedPercent) */
  remainingPercent: number;
  /** ISO timestamp when this window resets, null if unknown */
  resetAt: string | null;
  /** Whether usage surpassed threshold for this window (if provided by API) */
  surpassedThreshold?: boolean;
  /** Optional severity hint (warning/error) */
  severity?: string;
  /** Overage status when provided by API */
  overageStatus?: string;
  /** ISO timestamp when overage resets, if provided */
  overageResetsAt?: string | null;
  /** Why overage is disabled, if provided */
  overageDisabledReason?: string | null;
  /** Whether account is currently using overage */
  isUsingOverage?: boolean;
  /** Whether extra usage is enabled */
  hasExtraUsageEnabled?: boolean;
}

/** Core Claude usage window (5h/weekly) extracted from policy limits */
export interface ClaudeCoreUsageWindow {
  /** Source rate limit type */
  rateLimitType: string;
  /** Display label */
  label: string;
  /** Percentage remaining (0-100) */
  remainingPercent: number;
  /** ISO timestamp when quota resets, null if unknown */
  resetAt: string | null;
  /** Raw status string */
  status: string;
}

/** Core Claude usage summary with explicit 5h + weekly windows */
export interface ClaudeCoreUsageSummary {
  /** Short-cycle usage limit window (5h/session) */
  fiveHour: ClaudeCoreUsageWindow | null;
  /** Long-cycle usage limit window (weekly) */
  weekly: ClaudeCoreUsageWindow | null;
}

/**
 * Claude quota fetch result
 */
export interface ClaudeQuotaResult extends QuotaErrorMetadata {
  /** Whether fetch succeeded */
  success: boolean;
  /** Policy limit windows */
  windows: ClaudeQuotaWindow[];
  /** Explicit core usage windows (5h + weekly) */
  coreUsage?: ClaudeCoreUsageSummary;
  /** Timestamp of fetch */
  lastUpdated: number;
  /** Error message if fetch failed */
  error?: string;
  /** Account ID (email) this quota belongs to */
  accountId?: string;
  /** True if token is expired/invalid and re-auth is required */
  needsReauth?: boolean;
}

/**
 * Gemini CLI quota bucket (grouped by model series and token type)
 */
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

/**
 * Gemini CLI quota fetch result
 */
export interface GeminiCliQuotaResult extends QuotaErrorMetadata {
  /** Whether fetch succeeded */
  success: boolean;
  /** Quota buckets grouped by model series */
  buckets: GeminiCliBucket[];
  /** GCP project ID for this account */
  projectId: string | null;
  /** Timestamp of fetch */
  lastUpdated: number;
  /** Error message if fetch failed */
  error?: string;
  /** Account ID (email) this quota belongs to */
  accountId?: string;
  /** True if token is expired and needs re-authentication */
  needsReauth?: boolean;
}

/**
 * GitHub Copilot quota snapshot.
 */
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

/**
 * GitHub Copilot quota fetch result.
 */
export interface GhcpQuotaResult extends QuotaErrorMetadata {
  /** Whether fetch succeeded */
  success: boolean;
  /** Copilot plan type (individual/business/enterprise/free) */
  planType: string | null;
  /** Quota reset date/time (ISO string) */
  quotaResetDate: string | null;
  snapshots: {
    premiumInteractions: GhcpQuotaSnapshot;
    chat: GhcpQuotaSnapshot;
    completions: GhcpQuotaSnapshot;
  };
  /** Timestamp of fetch */
  lastUpdated: number;
  /** Error message if fetch failed */
  error?: string;
  /** Account ID this quota belongs to */
  accountId?: string;
  /** True if token is expired/invalid and user needs re-authentication */
  needsReauth?: boolean;
}
