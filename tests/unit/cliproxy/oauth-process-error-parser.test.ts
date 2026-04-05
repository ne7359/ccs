import { describe, expect, it } from 'bun:test';
import {
  extractLikelyAuthFailureFromStderr,
  getExpectedLocalCallback,
  getKiroBuilderIdSelectionInput,
  validateManualCallbackUrl,
} from '../../../src/cliproxy/auth/oauth-process';

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

describe('oauth-process manual callback validation', () => {
  const authUrl =
    'https://oidc.example.com/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Foauth%2Fcallback&state=test-state';

  it('extracts the expected local callback target from the auth URL', () => {
    expect(getExpectedLocalCallback(authUrl)).toEqual({
      origin: 'http://127.0.0.1:9876',
      pathname: '/oauth/callback',
      state: 'test-state',
    });
  });

  it('accepts matching loopback callback URLs', () => {
    expect(
      validateManualCallbackUrl(
        'http://127.0.0.1:9876/oauth/callback?code=abc123&state=test-state',
        authUrl
      )
    ).toBeNull();
  });

  it('rejects non-loopback callback URLs', () => {
    expect(
      validateManualCallbackUrl(
        'https://evil.example.com/oauth/callback?code=abc123&state=test-state',
        authUrl
      )
    ).toContain('local OAuth callback server');
  });

  it('rejects callback URLs with the wrong path or state', () => {
    expect(
      validateManualCallbackUrl(
        'http://127.0.0.1:9876/not-the-callback?code=abc123&state=test-state',
        authUrl
      )
    ).toContain('expected local OAuth callback target');

    expect(
      validateManualCallbackUrl(
        'http://127.0.0.1:9876/oauth/callback?code=abc123&state=wrong-state',
        authUrl
      )
    ).toContain('state does not match');
  });
});

describe('oauth-process Kiro Builder ID menu parsing', () => {
  it('selects Builder ID when it is the first option', () => {
    const output = `
Select login method
1. Builder ID
2. IAM Identity Center
`;

    expect(getKiroBuilderIdSelectionInput(output)).toBe('1\n');
  });

  it('selects the Builder ID option even when upstream reorders the menu', () => {
    const output = `
Select login method
1. IAM Identity Center
2. AWS Builder ID
`;

    expect(getKiroBuilderIdSelectionInput(output)).toBe('2\n');
  });

  it('returns null when the Builder ID option is not present in the prompt window', () => {
    const output = `
Select login method
1. IAM Identity Center
2. Google
`;

    expect(getKiroBuilderIdSelectionInput(output)).toBeNull();
  });
});
