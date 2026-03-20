/**
 * Thinking Budget Validator
 *
 * Validates user-provided thinking values against model capabilities.
 * - Clamps out-of-range budgets
 * - Maps invalid levels to closest valid
 * - Warns when model doesn't support thinking
 */

import { getModelThinkingSupport } from './model-catalog';
import type { ThinkingSupport } from './model-catalog';
import type { CLIProxyProvider } from './types';

/**
 * Thinking budget bounds (used for validation across API and CLI)
 */
export const THINKING_BUDGET_MIN = 0;
export const THINKING_BUDGET_MAX = 100000;
export const THINKING_BUDGET_DEFAULT_MIN = 512;

/**
 * Result of thinking value validation
 */
export interface ThinkingValidationResult {
  /** Whether the value is valid for the model */
  valid: boolean;
  /** The validated value (possibly clamped/mapped) */
  value: string | number;
  /** Warning message for user feedback */
  warning?: string;
}

/**
 * Named thinking level mappings to budget values (when converting level→budget)
 */
export const THINKING_LEVEL_BUDGETS: Record<string, number> = {
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 32768,
};

/**
 * Level rank for comparison (higher = more intensive)
 */
export const THINKING_LEVEL_RANK: Record<string, number> = {
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
};

/**
 * Valid thinking level names
 */
export const VALID_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'auto'] as const;
export type ThinkingLevel = (typeof VALID_THINKING_LEVELS)[number];

/**
 * Valid tier names for tier_defaults configuration
 */
export const VALID_THINKING_TIERS = ['opus', 'sonnet', 'haiku'] as const;
export type ThinkingTier = (typeof VALID_THINKING_TIERS)[number];

/**
 * Cap a level at the model's maximum supported level.
 * Returns the capped level and whether capping occurred.
 */
export function capLevelAtMax(
  level: string,
  maxLevel: string | undefined
): { level: string; capped: boolean } {
  if (!maxLevel) return { level, capped: false };
  const levelRank = THINKING_LEVEL_RANK[level] ?? 0;
  const maxRank = THINKING_LEVEL_RANK[maxLevel] ?? 5;
  if (levelRank > maxRank) {
    return { level: maxLevel, capped: true };
  }
  return { level, capped: false };
}

/**
 * Special thinking values
 */
export const THINKING_OFF_VALUES = ['off', 'none', 'disabled', '0'] as const;
export const THINKING_AUTO_VALUE = 'auto';

/**
 * Check whether a value should disable thinking.
 * Accepts common string aliases and numeric 0.
 */
export function isThinkingOffValue(value: unknown): boolean {
  if (typeof value === 'number') {
    return value === 0;
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    return THINKING_OFF_VALUES.includes(normalized as (typeof THINKING_OFF_VALUES)[number]);
  }
  return false;
}

/**
 * Find closest valid level using simple string matching
 * Returns undefined if no close match found
 */
function findClosestLevel(input: string, validLevels: string[]): string | undefined {
  const normalized = input.toLowerCase().trim();

  // Exact match first
  if (validLevels.includes(normalized)) {
    return normalized;
  }

  // Prefix matching (e.g., 'med' → 'medium', 'hi' → 'high')
  for (const level of validLevels) {
    if (level.startsWith(normalized)) {
      return level;
    }
  }

  // Common aliases
  const aliases: Record<string, string> = {
    min: 'minimal',
    lo: 'low',
    med: 'medium',
    mid: 'medium',
    hi: 'high',
    max: 'xhigh',
    ultra: 'xhigh',
    extreme: 'xhigh',
  };

  if (aliases[normalized] && validLevels.includes(aliases[normalized])) {
    return aliases[normalized];
  }

  return undefined;
}

/**
 * Validate a thinking value against model capabilities
 *
 * @param provider - The CLI proxy provider
 * @param modelId - The model identifier
 * @param value - User-provided thinking value (level name or budget number)
 * @returns Validation result with possibly clamped/mapped value and warnings
 */
export function validateThinking(
  provider: CLIProxyProvider,
  modelId: string,
  value: string | number
): ThinkingValidationResult {
  const thinking = getModelThinkingSupport(provider, modelId);

  // Handle string length limit to prevent performance issues
  if (typeof value === 'string' && value.length > 100) {
    return {
      valid: false,
      value: 'off',
      warning: 'Thinking value too long (max 100 chars). Using "off".',
    };
  }

  // Handle empty string explicitly
  if (typeof value === 'string' && value.trim() === '') {
    return {
      valid: false,
      value: 'off',
      warning: 'Empty thinking value not allowed. Using "off".',
    };
  }

  // Handle off/none/disabled values
  if (isThinkingOffValue(value)) {
    return { valid: true, value: 'off' };
  }

  // If model has no thinking support info, pass through
  if (!thinking) {
    return {
      valid: true,
      value,
      warning: `Model ${modelId} has unknown thinking support. Value passed through unchanged.`,
    };
  }

  // Model doesn't support thinking at all
  if (thinking.type === 'none') {
    return {
      valid: false,
      value: 'off',
      warning: `Model ${modelId} does not support extended thinking. Thinking disabled.`,
    };
  }

  // Handle 'auto' value
  if (typeof value === 'string' && value.toLowerCase().trim() === THINKING_AUTO_VALUE) {
    if (!thinking.dynamicAllowed) {
      return {
        valid: false,
        value:
          thinking.type === 'budget' ? (thinking.min ?? 1024) : (thinking.levels?.[0] ?? 'low'),
        warning: `Model ${modelId} does not support dynamic/auto thinking. Using minimum value.`,
      };
    }
    return { valid: true, value: 'auto' };
  }

  // Budget-type models
  if (thinking.type === 'budget') {
    return validateBudgetThinking(thinking, value, modelId);
  }

  // Level-type models
  if (thinking.type === 'levels') {
    return validateLevelThinking(thinking, value, modelId);
  }

  // Fallback
  return { valid: true, value };
}

/**
 * Validate budget-type thinking value
 */
function validateBudgetThinking(
  thinking: ThinkingSupport,
  value: string | number,
  modelId: string
): ThinkingValidationResult {
  const min = thinking.min ?? THINKING_BUDGET_MIN;
  const max = thinking.max ?? THINKING_BUDGET_MAX;

  // Convert level name to budget if needed
  let budget: number;
  if (typeof value === 'string') {
    const normalizedLevel = value.toLowerCase().trim();
    if (normalizedLevel in THINKING_LEVEL_BUDGETS) {
      budget = THINKING_LEVEL_BUDGETS[normalizedLevel];
    } else {
      // Strict number parsing: reject partial parses like "123abc"
      const parsed = Number(value);
      const trimmed = value.trim();
      // Accept trailing .0 for whole numbers (e.g., "8192.0" → 8192)
      const isWholeWithDecimal = Number.isInteger(parsed) && trimmed === `${parsed}.0`;
      if (
        isNaN(parsed) ||
        !Number.isFinite(parsed) ||
        (trimmed !== String(parsed) && !isWholeWithDecimal)
      ) {
        // Not a valid number, try to find closest level
        const closest = findClosestLevel(value, Object.keys(THINKING_LEVEL_BUDGETS));
        if (closest) {
          budget = THINKING_LEVEL_BUDGETS[closest];
        } else {
          return {
            valid: false,
            value: min || THINKING_BUDGET_DEFAULT_MIN,
            warning: `Invalid thinking value "${value}" for ${modelId}. Using minimum budget ${min || THINKING_BUDGET_DEFAULT_MIN}.`,
          };
        }
      } else {
        budget = parsed;
      }
    }
  } else {
    budget = value;
  }

  // Reject NaN/Infinity budgets
  if (!Number.isFinite(budget)) {
    return {
      valid: false,
      value: min || THINKING_BUDGET_DEFAULT_MIN,
      warning: `Budget must be a finite number. Using minimum ${min || THINKING_BUDGET_DEFAULT_MIN}.`,
    };
  }

  // Reject negative budgets
  if (budget < THINKING_BUDGET_MIN) {
    return {
      valid: false,
      value: min || THINKING_BUDGET_DEFAULT_MIN,
      warning: `Negative thinking budget not allowed. Using minimum ${min || THINKING_BUDGET_DEFAULT_MIN}.`,
    };
  }

  // Check zero budget
  if (budget === 0 && !thinking.zeroAllowed) {
    return {
      valid: false,
      value: min || THINKING_BUDGET_DEFAULT_MIN,
      warning: `Model ${modelId} does not support zero thinking budget. Using minimum ${min || THINKING_BUDGET_DEFAULT_MIN}.`,
    };
  }

  // Clamp to valid range
  if (budget < min) {
    return {
      valid: true,
      value: min,
      warning: `Thinking budget ${budget} below minimum for ${modelId}. Clamped to ${min}.`,
    };
  }

  if (budget > max) {
    return {
      valid: true,
      value: max,
      warning: `Thinking budget ${budget} exceeds maximum for ${modelId}. Clamped to ${max}.`,
    };
  }

  return { valid: true, value: budget };
}

/**
 * Validate level-type thinking value
 */
function validateLevelThinking(
  thinking: ThinkingSupport,
  value: string | number,
  modelId: string
): ThinkingValidationResult {
  const validLevels = thinking.levels ?? [];
  const maxLevel = thinking.maxLevel;

  // Helper to apply maxLevel cap and build result
  const applyMaxCap = (level: string, baseWarning?: string): ThinkingValidationResult => {
    const { level: cappedLevel, capped } = capLevelAtMax(level, maxLevel);
    const warnings: string[] = [];
    if (baseWarning) warnings.push(baseWarning);
    if (capped) {
      warnings.push(
        `Level "${level}" exceeds max "${maxLevel}" for ${modelId}. Capped to "${cappedLevel}".`
      );
    }
    return {
      valid: true,
      value: cappedLevel,
      warning: warnings.length > 0 ? warnings.join(' ') : undefined,
    };
  };

  // If numeric, try to map to closest level by budget
  if (typeof value === 'number') {
    // Find closest level by comparing to level budgets
    let closestLevel = validLevels[0] ?? 'low';
    let closestDiff = Infinity;

    for (const level of validLevels) {
      const levelBudget = THINKING_LEVEL_BUDGETS[level] ?? 8192;
      const diff = Math.abs(levelBudget - value);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestLevel = level;
      }
    }

    return applyMaxCap(
      closestLevel,
      `Model ${modelId} uses named levels. Mapped budget ${value} to "${closestLevel}".`
    );
  }

  // String level
  const normalizedLevel = value.toLowerCase().trim();

  // Check if it's a valid level for this model
  if (validLevels.includes(normalizedLevel)) {
    return applyMaxCap(normalizedLevel);
  }

  // Try to find closest match
  const closest = findClosestLevel(normalizedLevel, validLevels);
  if (closest) {
    return applyMaxCap(
      closest,
      `Level "${value}" not valid for ${modelId}. Mapped to "${closest}".`
    );
  }

  // If the input is a standard named level but this model only supports a subset,
  // choose the highest supported level that does not exceed the requested intensity.
  const requestedRank = THINKING_LEVEL_RANK[normalizedLevel];
  if (requestedRank && validLevels.length > 0) {
    const rankedValidLevels = validLevels
      .filter((level) => THINKING_LEVEL_RANK[level] !== undefined)
      .sort((a, b) => (THINKING_LEVEL_RANK[a] ?? 0) - (THINKING_LEVEL_RANK[b] ?? 0));

    if (rankedValidLevels.length > 0) {
      let mappedLevel = rankedValidLevels[0];
      for (const level of rankedValidLevels) {
        const levelRank = THINKING_LEVEL_RANK[level] ?? 0;
        if (levelRank <= requestedRank) {
          mappedLevel = level;
          continue;
        }
        break;
      }

      return applyMaxCap(
        mappedLevel,
        `Level "${value}" mapped to "${mappedLevel}" for ${modelId} (available: ${validLevels.join(', ')}).`
      );
    }
  }

  // Try to map from standard level names to model's levels
  const standardToModelLevel: Record<string, string> = {};
  const levelOrder = ['minimal', 'low', 'medium', 'high', 'xhigh'];

  // Build mapping based on position
  for (let i = 0; i < validLevels.length; i++) {
    // Map first half of standard levels to lower model levels, second half to higher
    const standardIdx = Math.floor((i / validLevels.length) * levelOrder.length);
    for (let j = standardIdx; j < levelOrder.length; j++) {
      if (!standardToModelLevel[levelOrder[j]]) {
        standardToModelLevel[levelOrder[j]] = validLevels[Math.min(i, validLevels.length - 1)];
      }
    }
  }

  const mapped = standardToModelLevel[normalizedLevel];
  if (mapped) {
    return applyMaxCap(
      mapped,
      `Level "${value}" mapped to "${mapped}" for ${modelId} (available: ${validLevels.join(', ')}).`
    );
  }

  // Default to first level
  const defaultLevel = validLevels[0] ?? 'low';
  return {
    valid: false,
    value: defaultLevel,
    warning: `Invalid level "${value}" for ${modelId}. Using "${defaultLevel}" (available: ${validLevels.join(', ')}).`,
  };
}
