/**
 * Shared validation helpers for composite CLIProxy variants.
 * Used by API routes, service layer, and config loader to avoid contract drift.
 */

import { CLIPROXY_SUPPORTED_PROVIDERS } from '../config/unified-config-types';
import type { CompositeTierConfig } from '../config/unified-config-types';
import type { CLIProxyProvider } from './types';
import { getDeniedModelIdReasonForProvider } from './model-id-normalizer';

export const VALID_COMPOSITE_TIERS = ['opus', 'sonnet', 'haiku'] as const;
export type CompositeTierName = (typeof VALID_COMPOSITE_TIERS)[number];

interface CompositeValidationOptions {
  defaultTier?: unknown;
  requireAllTiers?: boolean;
}

type CompositeTierInput = Partial<Record<CompositeTierName, CompositeTierConfig>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidProvider(provider: unknown): provider is CLIProxyProvider {
  return (
    typeof provider === 'string' &&
    CLIPROXY_SUPPORTED_PROVIDERS.includes(provider as CLIProxyProvider)
  );
}

export function validateCompositeDefaultTier(defaultTier: unknown): string | null {
  if (
    defaultTier !== undefined &&
    !VALID_COMPOSITE_TIERS.includes(defaultTier as CompositeTierName)
  ) {
    return `Invalid default_tier '${String(defaultTier)}': must be one of ${VALID_COMPOSITE_TIERS.join(', ')}`;
  }
  return null;
}

/**
 * Validate composite tier payload.
 *
 * Create mode (`requireAllTiers=true`): all tiers required.
 * Update mode (`requireAllTiers=false`): partial tiers allowed.
 */
export function validateCompositeTiers(
  tiers: unknown,
  options: CompositeValidationOptions = {}
): string | null {
  const { defaultTier, requireAllTiers = false } = options;

  const defaultTierError = validateCompositeDefaultTier(defaultTier);
  if (defaultTierError) {
    return defaultTierError;
  }

  if (!isRecord(tiers)) {
    return "Invalid tiers payload: expected object with tier keys ('opus', 'sonnet', 'haiku')";
  }

  const tierMap = tiers as CompositeTierInput;

  for (const tier of VALID_COMPOSITE_TIERS) {
    const tierValue = tierMap[tier];

    if (requireAllTiers && tierValue === undefined) {
      return `Missing required tier '${tier}': all tiers (opus, sonnet, haiku) required for create`;
    }

    if (tierValue === undefined) {
      continue;
    }

    if (!isRecord(tierValue)) {
      return `Invalid tier config for '${tier}': expected object with provider and model`;
    }

    const provider = tierValue.provider;
    const model = tierValue.model;

    if (typeof provider !== 'string' || typeof model !== 'string') {
      return `Invalid tier config for '${tier}': requires 'provider' and 'model' strings`;
    }

    if (!model.trim()) {
      return `Invalid model for tier '${tier}': model cannot be empty or whitespace`;
    }

    if (!isValidProvider(provider)) {
      return `Invalid provider '${provider}' for tier '${tier}': must be one of ${CLIPROXY_SUPPORTED_PROVIDERS.join(', ')}`;
    }

    const deniedTierModelReason = getDeniedModelIdReasonForProvider(model, provider);
    if (deniedTierModelReason) {
      return `Invalid model for tier '${tier}': ${deniedTierModelReason}`;
    }

    if (tierValue.fallback !== undefined) {
      const fallback = tierValue.fallback;
      if (!isRecord(fallback)) {
        return `Invalid fallback config for tier '${tier}': expected object with provider and model`;
      }

      if (typeof fallback.provider !== 'string' || typeof fallback.model !== 'string') {
        return `Invalid fallback config for tier '${tier}': requires 'provider' and 'model' strings`;
      }

      if (!fallback.model.trim()) {
        return `Invalid fallback model for tier '${tier}': model cannot be empty or whitespace`;
      }

      if (!isValidProvider(fallback.provider)) {
        return `Invalid fallback provider '${fallback.provider}' for tier '${tier}': must be one of ${CLIPROXY_SUPPORTED_PROVIDERS.join(', ')}`;
      }

      const deniedFallbackReason = getDeniedModelIdReasonForProvider(
        fallback.model,
        fallback.provider
      );
      if (deniedFallbackReason) {
        return `Invalid fallback model for tier '${tier}': ${deniedFallbackReason}`;
      }

      if (fallback.provider === provider && fallback.model === model) {
        return `Circular fallback in tier '${tier}': fallback cannot point to same provider and model`;
      }
    }
  }

  return null;
}
