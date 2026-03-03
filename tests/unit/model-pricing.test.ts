/**
 * Unit tests for model-pricing.ts
 */
import { describe, it, expect } from 'bun:test';
import {
  getModelPricing,
  calculateCost,
  getKnownModels,
  hasCustomPricing,
  type TokenUsage,
} from '../../src/web-server/model-pricing';

describe('model-pricing', () => {
  describe('getModelPricing', () => {
    it('should return exact match pricing', () => {
      const pricing = getModelPricing('claude-sonnet-4-5-20250929');
      expect(pricing.inputPerMillion).toBe(3.0);
      expect(pricing.outputPerMillion).toBe(15.0);
    });

    it('should return pricing for all known models', () => {
      const knownModels = getKnownModels();
      expect(knownModels.length).toBeGreaterThanOrEqual(60); // 62 models from better-ccusage integration

      for (const model of knownModels) {
        const pricing = getModelPricing(model);
        expect(pricing).toBeDefined();
        expect(typeof pricing.inputPerMillion).toBe('number');
      }
    });

    it('should return fallback pricing for unknown models', () => {
      const pricing = getModelPricing('unknown-model-xyz');
      expect(pricing.inputPerMillion).toBe(3.0);
      expect(pricing.outputPerMillion).toBe(15.0);
    });

    it('should handle provider-prefixed model names', () => {
      const pricing = getModelPricing('anthropic/claude-sonnet-4-5');
      expect(pricing).toBeDefined();
      // Should match via normalization
    });

    it('should resolve lowercase MiniMax model IDs to custom pricing', () => {
      const pricing = getModelPricing('minimax-m2.5');
      expect(pricing.inputPerMillion).toBe(0.3);
      expect(pricing.outputPerMillion).toBe(1.2);
    });

    it('should resolve provider-prefixed MiniMax model IDs to custom pricing', () => {
      const pricing = getModelPricing('minimax/MiniMax-M2.5');
      expect(pricing.inputPerMillion).toBe(0.3);
      expect(pricing.outputPerMillion).toBe(1.2);
    });

    it('should use updated MiniMax-M2.1-lightning input pricing', () => {
      const pricing = getModelPricing('MiniMax-M2.1-lightning');
      expect(pricing.inputPerMillion).toBe(0.6);
    });

    it('should not use fallback pricing for known Qwen catalog IDs', () => {
      const fallback = getModelPricing('unknown-model-xyz');
      const catalogIds = ['qwen3-235b', 'qwen3-vl-plus', 'qwen3-32b'];

      for (const model of catalogIds) {
        const pricing = getModelPricing(model);
        expect(pricing).not.toEqual(fallback);
      }
    });

    it('should map qwen3-coder to deterministic custom pricing', () => {
      const pricing = getModelPricing('qwen3-coder');
      const canonical = getModelPricing('qwen3-coder-plus');

      expect(pricing).toEqual(canonical);
      expect(pricing).not.toEqual(getModelPricing('unknown-model-xyz'));
    });

    it('should return different pricing for different model tiers', () => {
      const sonnet = getModelPricing('claude-sonnet-4-5');
      const opus = getModelPricing('claude-opus-4-5-20251101');
      const haiku = getModelPricing('claude-haiku-4-5-20251001');

      expect(opus.inputPerMillion).toBeGreaterThan(sonnet.inputPerMillion);
      expect(sonnet.inputPerMillion).toBeGreaterThan(haiku.inputPerMillion);
    });

    it('should return correct pricing for Claude Opus 4.6 (not 3x Opus 4 rate)', () => {
      const opus46 = getModelPricing('claude-opus-4-6');
      expect(opus46.inputPerMillion).toBe(5.0);
      expect(opus46.outputPerMillion).toBe(25.0);
    });

    it('should return correct pricing for Claude Opus 4.6 thinking variant', () => {
      const opus46t = getModelPricing('claude-opus-4-6-thinking');
      expect(opus46t.inputPerMillion).toBe(5.0);
      expect(opus46t.outputPerMillion).toBe(25.0);
    });

    it('should return correct pricing for Claude Sonnet 4.6', () => {
      const sonnet46 = getModelPricing('claude-sonnet-4-6');
      expect(sonnet46.inputPerMillion).toBe(3.0);
      expect(sonnet46.outputPerMillion).toBe(15.0);
    });

    it('should match date-stamped Claude Opus 4.6 to correct pricing', () => {
      const opus46dated = getModelPricing('claude-opus-4-6-20260101');
      expect(opus46dated.inputPerMillion).toBe(5.0);
      expect(opus46dated.outputPerMillion).toBe(25.0);
    });

    it('should match date-stamped Claude Sonnet 4.6 to correct pricing', () => {
      const sonnet46dated = getModelPricing('claude-sonnet-4-6-20260115');
      expect(sonnet46dated.inputPerMillion).toBe(3.0);
      expect(sonnet46dated.outputPerMillion).toBe(15.0);
    });

    it('should match provider-prefixed date-stamped model to correct pricing', () => {
      const opus46 = getModelPricing('anthropic/claude-opus-4-6-20260101');
      expect(opus46.inputPerMillion).toBe(5.0);
      expect(opus46.outputPerMillion).toBe(25.0);
    });

    it('should match date-stamped thinking Claude Opus 4.6 to correct pricing', () => {
      const opus46 = getModelPricing('claude-opus-4-6-20260101-thinking');
      expect(opus46.inputPerMillion).toBe(5.0);
      expect(opus46.outputPerMillion).toBe(25.0);
    });

    it('should match provider-prefixed date-stamped thinking model to correct pricing', () => {
      const opus46 = getModelPricing('anthropic/claude-opus-4-6-20260101-thinking');
      expect(opus46.inputPerMillion).toBe(5.0);
      expect(opus46.outputPerMillion).toBe(25.0);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost correctly for input tokens', () => {
      const usage: TokenUsage = {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      const cost = calculateCost(usage, 'claude-sonnet-4-5');
      expect(cost).toBe(3.0); // $3.00 per million input tokens
    });

    it('should calculate cost correctly for output tokens', () => {
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 1_000_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      const cost = calculateCost(usage, 'claude-sonnet-4-5');
      expect(cost).toBe(15.0); // $15.00 per million output tokens
    });

    it('should calculate combined cost correctly', () => {
      const usage: TokenUsage = {
        inputTokens: 500_000,
        outputTokens: 100_000,
        cacheCreationTokens: 50_000,
        cacheReadTokens: 200_000,
      };
      const cost = calculateCost(usage, 'claude-sonnet-4-5');
      // 0.5M * 3.0 + 0.1M * 15.0 + 0.05M * 3.75 + 0.2M * 0.30
      // = 1.5 + 1.5 + 0.1875 + 0.06
      expect(cost).toBeCloseTo(3.2475, 4);
    });

    it('should return 0 for zero usage', () => {
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      const cost = calculateCost(usage, 'claude-sonnet-4-5');
      expect(cost).toBe(0);
    });

    it('should return 0 cost for free-tier/experimental models', () => {
      const usage: TokenUsage = {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheCreationTokens: 100_000,
        cacheReadTokens: 50_000,
      };
      const cost = calculateCost(usage, 'gemini-2.0-flash-exp');
      expect(cost).toBe(0); // Experimental models are free
    });

    it('should calculate Claude Opus 4.6 cost including cache token rates', () => {
      const usage: TokenUsage = {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      };
      const cost = calculateCost(usage, 'claude-opus-4-6');
      expect(cost).toBe(36.75); // 5 + 25 + 6.25 + 0.5
    });
  });

  describe('getKnownModels', () => {
    it('should return array of model names', () => {
      const models = getKnownModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it('should include Claude models', () => {
      const models = getKnownModels();
      expect(models.some((m) => m.startsWith('claude-'))).toBe(true);
    });

    it('should include GLM models', () => {
      const models = getKnownModels();
      expect(models.some((m) => m.startsWith('glm-'))).toBe(true);
    });
  });

  describe('hasCustomPricing', () => {
    it('should return true for known models', () => {
      expect(hasCustomPricing('claude-sonnet-4-5')).toBe(true);
      expect(hasCustomPricing('glm-4.6')).toBe(true);
    });

    it('should return true for deterministic qwen3-coder alias', () => {
      expect(hasCustomPricing('qwen3-coder')).toBe(true);
    });

    it('should not treat date-stamped non-Claude IDs as deterministic aliases', () => {
      expect(hasCustomPricing('qwen3-32b-20260101')).toBe(false);
    });

    it('should return false for unknown models', () => {
      expect(hasCustomPricing('unknown-model-xyz')).toBe(false);
    });
  });
});
