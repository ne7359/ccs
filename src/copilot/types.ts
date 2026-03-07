/**
 * Copilot API Types
 *
 * Type definitions for GitHub Copilot proxy integration.
 */

/**
 * Copilot authentication status.
 */
export interface CopilotAuthStatus {
  authenticated: boolean;
  /** GitHub username if authenticated */
  username?: string;
  /** Error message if auth check failed */
  error?: string;
}

/**
 * Copilot daemon status.
 */
export interface CopilotDaemonStatus {
  running: boolean;
  port: number;
  /** Process ID if running */
  pid?: number;
  /** Version if available */
  version?: string;
}

/**
 * Combined copilot status.
 */
export interface CopilotStatus {
  auth: CopilotAuthStatus;
  daemon: CopilotDaemonStatus;
}

/**
 * Copilot plan tier for model availability.
 * Based on GitHub Copilot plans.
 */
export type CopilotPlanTier = 'free' | 'pro' | 'pro+' | 'business' | 'enterprise';

export interface CopilotModelLimits {
  /** Maximum total context window exposed by GitHub Copilot */
  maxContextWindowTokens?: number;
  /** Maximum output/completion tokens exposed by GitHub Copilot */
  maxOutputTokens?: number;
  /** Maximum prompt/input tokens exposed by GitHub Copilot */
  maxPromptTokens?: number;
}

/**
 * Copilot model information.
 */
export interface CopilotModel {
  id: string;
  name: string;
  /** Provider: openai or anthropic */
  provider: 'openai' | 'anthropic';
  /** Whether this is the default model */
  isDefault?: boolean;
  /** Minimum plan tier required (free = available to all) */
  minPlan?: CopilotPlanTier;
  /** Premium request multiplier (0 = free, higher = more expensive) */
  multiplier?: number;
  /** Whether this model is in preview */
  preview?: boolean;
  /** Live model limits returned by GitHub Copilot metadata, when available */
  limits?: CopilotModelLimits;
}

/**
 * Copilot debug info from `copilot-api debug --json`.
 */
export interface CopilotDebugInfo {
  version?: string;
  runtime?: string;
  authenticated?: boolean;
  tokenPath?: string;
}

/**
 * Quota snapshot from Copilot usage endpoint.
 */
export interface CopilotQuotaSnapshot {
  /** Total quota allocation for this bucket */
  entitlement: number;
  /** Remaining quota count */
  remaining: number;
  /** Used quota count */
  used: number;
  /** Remaining quota percentage (0-100) */
  percentRemaining: number;
  /** Used quota percentage (0-100) */
  percentUsed: number;
  /** Whether quota is unlimited */
  unlimited: boolean;
}

/**
 * Normalized Copilot usage response used by CLI and dashboard.
 */
export interface CopilotUsage {
  /** Copilot plan name (free/pro/business/enterprise) */
  plan: string | null;
  /** ISO date string when quota resets */
  quotaResetDate: string | null;
  quotas: {
    premiumInteractions: CopilotQuotaSnapshot;
    chat: CopilotQuotaSnapshot;
    completions: CopilotQuotaSnapshot;
  };
}
