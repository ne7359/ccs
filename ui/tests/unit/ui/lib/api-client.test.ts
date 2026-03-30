import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api-client';

function createEmptyJsonResponse(status = 200): Response {
  return new Response('{}', {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('cliproxy account API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes duplicate-email account ids for account auth actions', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(createEmptyJsonResponse()));
    vi.stubGlobal('fetch', fetchMock);

    const accountId = 'kaidu.kd@gmail.com#04a0f049-team';
    const encodedAccountId = encodeURIComponent(accountId);

    await api.cliproxy.accounts.remove('codex', accountId);
    await api.cliproxy.accounts.pause('codex', accountId);
    await api.cliproxy.accounts.resume('codex', accountId);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/cliproxy/auth/accounts/codex/${encodedAccountId}`
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/cliproxy/auth/accounts/codex/${encodedAccountId}/pause`
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `/api/cliproxy/auth/accounts/codex/${encodedAccountId}/resume`
    );
  });
});
