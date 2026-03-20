/**
 * Extended Context Configuration
 *
 * Handles the [1m] suffix for models supporting 1M token context window.
 * Claude Code recognizes this suffix to enable extended context.
 *
 * Behavior:
 * - Gemini family (gemini-*): Auto-enabled by default
 * - Claude (Anthropic): Opt-in via --1m flag
 */

import type { CLIProxyProvider } from '../types';
import { supportsExtendedContext } from '../model-catalog';
import { warn } from '../../utils/ui';
import {
  applyExtendedContextSuffix as applyExtendedContextSuffixShared,
  isNativeGeminiModel,
  stripExtendedContextSuffix,
} from '../../shared/extended-context-utils';

// Backward-compatible export retained for tests/importers that reference this module.
export function applyExtendedContextSuffix(modelId: string): string {
  return applyExtendedContextSuffixShared(modelId);
}

/**
 * Determine if extended context should be applied to a model.
 *
 * @param provider - CLIProxy provider
 * @param modelId - Base model ID (without suffixes)
 * @param extendedContextOverride - CLI override (true = force on, false = force off, undefined = auto)
 * @returns Whether to apply extended context suffix
 */
export function shouldApplyExtendedContext(
  provider: CLIProxyProvider,
  modelId: string,
  extendedContextOverride?: boolean
): boolean {
  // Explicit override takes priority
  if (extendedContextOverride === true) {
    // User explicitly requested --1m
    const supported = supportsExtendedContext(provider, modelId);
    if (!supported) {
      console.error(warn(`Model "${modelId}" does not support 1M extended context. Flag ignored.`));
    }
    return supported;
  }
  if (extendedContextOverride === false) {
    // User explicitly disabled with --no-1m
    return false;
  }

  // Auto behavior: enable for native Gemini models only
  if (isNativeGeminiModel(modelId)) {
    return supportsExtendedContext(provider, modelId);
  }

  // For other models (Claude, etc.), default to off - require explicit --1m
  return false;
}

/**
 * Apply extended context configuration to env vars.
 * Modifies ANTHROPIC_MODEL and tier models with [1m] suffix.
 *
 * @param envVars - Environment variables to modify (mutated in place)
 * @param provider - CLIProxy provider
 * @param extendedContextOverride - CLI override (true = force on, false = force off, undefined = auto)
 */
export function applyExtendedContextConfig(
  envVars: NodeJS.ProcessEnv,
  provider: CLIProxyProvider,
  extendedContextOverride?: boolean
): void {
  // Get base model to check support (strip any existing suffixes for lookup)
  const baseModel = envVars.ANTHROPIC_MODEL || '';
  const cleanModelId = stripModelSuffixes(baseModel);

  // Tier model env vars to apply/strip extended context suffix
  const tierModels = [
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  ] as const;

  if (!shouldApplyExtendedContext(provider, cleanModelId, extendedContextOverride)) {
    // Strip [1m] suffix from models that no longer support extended context
    // (e.g., user had it enabled before backend dropped support)
    if (envVars.ANTHROPIC_MODEL?.toLowerCase().endsWith('[1m]')) {
      envVars.ANTHROPIC_MODEL = envVars.ANTHROPIC_MODEL.replace(/\[1m\]$/i, '');
    }
    for (const tierVar of tierModels) {
      const model = envVars[tierVar];
      if (model?.toLowerCase().endsWith('[1m]')) {
        envVars[tierVar] = model.replace(/\[1m\]$/i, '');
      }
    }
    return;
  }

  // Apply suffix to main model
  if (envVars.ANTHROPIC_MODEL) {
    envVars.ANTHROPIC_MODEL = applyExtendedContextSuffixShared(envVars.ANTHROPIC_MODEL);
  }

  // Apply to tier models if they support extended context

  for (const tierVar of tierModels) {
    const model = envVars[tierVar];
    if (model) {
      const tierCleanId = stripModelSuffixes(model);
      if (shouldApplyExtendedContext(provider, tierCleanId, extendedContextOverride)) {
        envVars[tierVar] = applyExtendedContextSuffixShared(model);
      }
    }
  }
}

/**
 * Strip thinking and extended context suffixes from model ID for catalog lookup.
 * Examples:
 *   "gemini-2.5-pro(high)[1m]" -> "gemini-2.5-pro"
 *   "gemini-2.5-pro(8192)" -> "gemini-2.5-pro"
 *   "gemini-2.5-pro" -> "gemini-2.5-pro"
 */
function stripModelSuffixes(modelId: string): string {
  return stripExtendedContextSuffix(modelId.trim()).replace(/\([^)]+\)$/, '');
}
