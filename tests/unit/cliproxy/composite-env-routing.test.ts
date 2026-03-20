/**
 * Composite environment routing tests.
 */

import { describe, it, expect } from 'bun:test';
import { buildClaudeEnvironment } from '../../../src/cliproxy/executor/env-resolver';

const tiers = {
  opus: { provider: 'agy' as const, model: 'claude-opus-4-6-thinking' },
  sonnet: { provider: 'gemini' as const, model: 'gemini-2.5-pro' },
  haiku: { provider: 'codex' as const, model: 'gpt-5.1-codex-mini' },
};

describe('buildClaudeEnvironment - composite remote routing', () => {
  it('uses remote base URL and auth token for direct remote composite mode', () => {
    const env = buildClaudeEnvironment({
      provider: 'agy',
      useRemoteProxy: true,
      remoteConfig: {
        host: 'remote.example.com',
        port: 9443,
        protocol: 'https',
        authToken: 'remote-auth-token',
      },
      localPort: 8318,
      verbose: false,
      isComposite: true,
      compositeTiers: tiers,
      compositeDefaultTier: 'sonnet',
    });

    expect(env.ANTHROPIC_BASE_URL).toBe('https://remote.example.com:9443');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('remote-auth-token');
    expect(env.ANTHROPIC_BASE_URL).not.toContain('/api/provider/');
  });

  it('uses local tunnel endpoint for HTTPS remote composite mode', () => {
    const env = buildClaudeEnvironment({
      provider: 'agy',
      useRemoteProxy: true,
      remoteConfig: {
        host: 'remote.example.com',
        port: 9443,
        protocol: 'https',
        authToken: 'remote-auth-token',
      },
      httpsTunnel: {} as never,
      tunnelPort: 9911,
      localPort: 8318,
      verbose: false,
      isComposite: true,
      compositeTiers: tiers,
      compositeDefaultTier: 'sonnet',
    });

    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9911');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('remote-auth-token');
    expect(env.ANTHROPIC_BASE_URL).not.toContain('/api/provider/');
  });

  it('applies thinking override to resolved env models', () => {
    const env = buildClaudeEnvironment({
      provider: 'gemini',
      useRemoteProxy: false,
      localPort: 8318,
      verbose: false,
      thinkingOverride: 'high',
    });

    expect(env.ANTHROPIC_MODEL).toContain('gemini');
    // Gemini thinking overrides may be normalized to numeric budgets, and [1m] may be auto-appended.
    expect(env.ANTHROPIC_MODEL).toMatch(/\([^)]+\)(\[1m\])?$/);
  });

  it('normalizes dotted Claude model IDs for antigravity tiers in composite mode', () => {
    const env = buildClaudeEnvironment({
      provider: 'agy',
      useRemoteProxy: false,
      localPort: 8318,
      verbose: false,
      isComposite: true,
      compositeTiers: {
        opus: { provider: 'agy', model: 'claude-opus-4.6-thinking' },
        sonnet: { provider: 'gemini', model: 'gemini-2.5-pro' },
        haiku: { provider: 'codex', model: 'gpt-5.1-codex-mini' },
      },
      compositeDefaultTier: 'opus',
    });

    expect(env.ANTHROPIC_MODEL).toMatch(/^claude-opus-4-6-thinking(\([^)]+\))?$/);
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toMatch(/^claude-opus-4-6-thinking(\([^)]+\))?$/);
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toMatch(/^gemini-2.5-pro(\([^)]+\))?$/);
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toMatch(/^gpt-5.1-codex-mini(?:-medium)?$/);
  });
});
