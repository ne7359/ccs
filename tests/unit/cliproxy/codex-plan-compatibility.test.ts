import { describe, expect, it } from 'bun:test';
import { getProviderCatalog, getModelMaxLevel } from '../../../src/cliproxy/model-catalog';
import {
  getDefaultCodexModel,
  getFreePlanFallbackCodexModel,
} from '../../../src/cliproxy/codex-plan-compatibility';

describe('codex plan compatibility', () => {
  it('uses a cross-plan safe Codex default', () => {
    expect(getDefaultCodexModel()).toBe('gpt-5-codex');
    expect(getProviderCatalog('codex')?.defaultModel).toBe('gpt-5-codex');
  });

  it('maps paid-only free-plan models to safe fallbacks', () => {
    expect(getFreePlanFallbackCodexModel('gpt-5.3-codex')).toBe('gpt-5-codex');
    expect(getFreePlanFallbackCodexModel('gpt-5.3-codex-xhigh')).toBe('gpt-5-codex');
    expect(getFreePlanFallbackCodexModel('gpt-5.3-codex(high)')).toBe('gpt-5-codex');
    expect(getFreePlanFallbackCodexModel('gpt-5.4')).toBe('gpt-5-codex');
    expect(getFreePlanFallbackCodexModel('gpt-5.3-codex-spark')).toBe('gpt-5-codex-mini');
  });

  it('does not rewrite cross-plan or already-safe Codex models', () => {
    expect(getFreePlanFallbackCodexModel('gpt-5-codex')).toBeNull();
    expect(getFreePlanFallbackCodexModel('gpt-5.2-codex')).toBeNull();
    expect(getFreePlanFallbackCodexModel('gpt-5.1-codex-mini')).toBeNull();
  });

  it('tracks Codex thinking caps for current safe defaults and paid models', () => {
    expect(getModelMaxLevel('codex', 'gpt-5-codex')).toBe('high');
    expect(getModelMaxLevel('codex', 'gpt-5-codex-mini')).toBe('high');
    expect(getModelMaxLevel('codex', 'gpt-5.2-codex')).toBe('xhigh');
    expect(getModelMaxLevel('codex', 'gpt-5.3-codex')).toBe('xhigh');
  });
});
