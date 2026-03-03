import { describe, expect, it } from 'bun:test';
import { extractLikelyAuthFailureFromStderr } from '../../../src/cliproxy/auth/oauth-process';

describe('oauth-process stderr parsing', () => {
  it('ignores non-ghcp providers', () => {
    const stderr =
      'time="2026-03-03T10:00:00Z" level=error msg="GitHub Copilot authentication failed: example"';

    expect(extractLikelyAuthFailureFromStderr('qwen', stderr)).toBeNull();
  });

  it('extracts copilot verification failures from logrus lines', () => {
    const stderr =
      'time="2026-03-03T10:00:00Z" level=error msg="GitHub Copilot authentication failed: github-copilot: failed to verify Copilot access - you may not have an active Copilot subscription: 403 Forbidden"';

    expect(extractLikelyAuthFailureFromStderr('ghcp', stderr)).toBe(
      'github-copilot: failed to verify Copilot access - you may not have an active Copilot subscription: 403 Forbidden'
    );
  });

  it('extracts generic authentication failure lines', () => {
    const stderr = 'level=error msg="Authentication failed: state mismatch"';

    expect(extractLikelyAuthFailureFromStderr('ghcp', stderr)).toBe('state mismatch');
  });

  it('caps extracted message length to prevent noisy broadcasts', () => {
    const longSuffix = 'x'.repeat(400);
    const stderr = `level=error msg="Authentication failed: ${longSuffix}"`;

    const parsed = extractLikelyAuthFailureFromStderr('ghcp', stderr);
    expect(parsed).not.toBeNull();
    expect((parsed as string).length).toBe(240);
  });
});
