import { describe, expect, it } from 'bun:test';
import {
  getStartAuthFailureMessage,
  getStartUrlUnsupportedReason,
} from '../../../src/web-server/routes/cliproxy-auth-routes';

describe('cliproxy-auth-routes start-url guard', () => {
  it('rejects device code providers', () => {
    expect(getStartUrlUnsupportedReason('kiro')).toContain(
      "Kiro method 'aws' uses Device Code flow"
    );
    expect(getStartUrlUnsupportedReason('ghcp')).toContain("Provider 'ghcp' uses Device Code flow");
    expect(getStartUrlUnsupportedReason('qwen')).toContain("Provider 'qwen' uses Device Code flow");
  });

  it('allows Kiro social methods on start-url', () => {
    expect(getStartUrlUnsupportedReason('kiro', { kiroMethod: 'google' })).toBeNull();
    expect(getStartUrlUnsupportedReason('kiro', { kiroMethod: 'github' })).toBeNull();
  });

  it('rejects Kiro aws-authcode method on start-url', () => {
    expect(getStartUrlUnsupportedReason('kiro', { kiroMethod: 'aws-authcode' })).toContain(
      "Kiro method 'aws-authcode' uses CLI auth flow"
    );
  });

  it('allows authorization code providers', () => {
    expect(getStartUrlUnsupportedReason('gemini')).toBeNull();
    expect(getStartUrlUnsupportedReason('codex')).toBeNull();
    expect(getStartUrlUnsupportedReason('claude')).toBeNull();
  });
});

describe('cliproxy-auth-routes start failure messaging', () => {
  it('returns ghcp-specific guidance for Copilot verification failures', () => {
    expect(getStartAuthFailureMessage('ghcp')).toContain(
      'GitHub Copilot verification did not complete'
    );
  });

  it('keeps generic failure text for other providers', () => {
    expect(getStartAuthFailureMessage('gemini')).toBe('Authentication failed or was cancelled');
    expect(getStartAuthFailureMessage('kiro')).toBe('Authentication failed or was cancelled');
  });
});
