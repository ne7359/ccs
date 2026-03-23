import { afterEach, describe, expect, it } from 'bun:test';
import type { ProxyTarget } from '../../../src/cliproxy/proxy-target-resolver';
import { getCapturedFetchRequests, mockFetch, restoreFetch } from '../../mocks';

const remoteTarget: ProxyTarget = {
  host: 'proxy.example.com',
  port: 8317,
  protocol: 'https',
  managementKey: 'test-mgmt-key',
  isRemote: true,
};

afterEach(() => {
  restoreFetch();
});

describe('requestPasteCallbackStart', () => {
  it('uses management auth-url route for non-kiro providers', async () => {
    mockFetch([
      {
        url: /\/v0\/management\/anthropic-auth-url\?is_webui=true$/,
        response: { auth_url: 'https://auth.example.com/claude' },
      },
    ]);

    const { requestPasteCallbackStart } = await import(
      `../../../src/cliproxy/auth/oauth-handler?request-claude-start=${Date.now()}`
    );
    const startData = await requestPasteCallbackStart('claude', remoteTarget);

    expect(startData.auth_url).toBe('https://auth.example.com/claude');

    const [request] = getCapturedFetchRequests();
    expect(request.url).toBe(
      'https://proxy.example.com:8317/v0/management/anthropic-auth-url?is_webui=true'
    );
    expect(request.method).toBe('GET');
    expect(request.headers['Authorization']).toBe('Bearer test-mgmt-key');
    expect(request.headers['Content-Type']).toBeUndefined();
  });

  it('keeps kiro on the legacy start route with POST', async () => {
    mockFetch([
      {
        url: /\/oauth\/kiro\/start$/,
        method: 'POST',
        response: { auth_url: 'https://auth.example.com/kiro' },
      },
    ]);

    const { requestPasteCallbackStart } = await import(
      `../../../src/cliproxy/auth/oauth-handler?request-kiro-start=${Date.now()}`
    );
    const startData = await requestPasteCallbackStart('kiro', remoteTarget);

    expect(startData.auth_url).toBe('https://auth.example.com/kiro');

    const [request] = getCapturedFetchRequests();
    expect(request.url).toBe('https://proxy.example.com:8317/oauth/kiro/start');
    expect(request.method).toBe('POST');
    expect(request.headers['Authorization']).toBe('Bearer test-mgmt-key');
    expect(request.headers['Content-Type']).toBe('application/json');
  });
});

describe('resolvePasteCallbackAuthUrl', () => {
  it('returns the immediate auth URL without polling', async () => {
    const { resolvePasteCallbackAuthUrl } = await import(
      `../../../src/cliproxy/auth/oauth-handler?resolve-immediate-auth-url=${Date.now()}`
    );
    const authUrl = await resolvePasteCallbackAuthUrl(
      remoteTarget,
      { auth_url: 'https://auth.example.com/direct' },
      50,
      0
    );

    expect(authUrl).toBe('https://auth.example.com/direct');
    expect(getCapturedFetchRequests()).toHaveLength(0);
  });

  it('polls management status when the start response only returns state', async () => {
    mockFetch([
      {
        url: /\/v0\/management\/get-auth-status\?state=state-123$/,
        response: { status: 'auth_url', auth_url: 'https://auth.example.com/polled' },
      },
    ]);

    const { resolvePasteCallbackAuthUrl } = await import(
      `../../../src/cliproxy/auth/oauth-handler?resolve-polled-auth-url=${Date.now()}`
    );
    const authUrl = await resolvePasteCallbackAuthUrl(remoteTarget, { state: 'state-123' }, 50, 0);

    expect(authUrl).toBe('https://auth.example.com/polled');

    const [request] = getCapturedFetchRequests();
    expect(request.url).toBe(
      'https://proxy.example.com:8317/v0/management/get-auth-status?state=state-123'
    );
    expect(request.method).toBe('GET');
    expect(request.headers['Authorization']).toBe('Bearer test-mgmt-key');
  });
});

describe('getCliAuthNicknameError', () => {
  it('allows omitted nicknames for no-email providers', async () => {
    const { getCliAuthNicknameError } = await import(
      `../../../src/cliproxy/auth/oauth-handler?cli-nickname-empty=${Date.now()}`
    );

    expect(getCliAuthNicknameError('kiro', undefined, [])).toBeNull();
    expect(getCliAuthNicknameError('ghcp', undefined, [])).toBeNull();
  });

  it('rejects invalid supplied nicknames before OAuth starts', async () => {
    const { getCliAuthNicknameError } = await import(
      `../../../src/cliproxy/auth/oauth-handler?cli-nickname-invalid=${Date.now()}`
    );

    expect(getCliAuthNicknameError('kiro', 'bad nickname', [])).toBe(
      'Nickname cannot contain whitespace'
    );
  });

  it('rejects supplied nicknames that collide with existing ids or nicknames', async () => {
    const { getCliAuthNicknameError } = await import(
      `../../../src/cliproxy/auth/oauth-handler?cli-nickname-conflict=${Date.now()}`
    );
    const existingAccounts = [
      { id: 'github-ABC123', nickname: 'work' },
      { id: 'ghcp-2', nickname: 'personal' },
    ];

    expect(getCliAuthNicknameError('ghcp', 'github-ABC123', existingAccounts)).toBe(
      'Nickname "github-ABC123" is already in use. Choose a different one.'
    );
    expect(getCliAuthNicknameError('ghcp', 'work', existingAccounts)).toBe(
      'Nickname "work" is already in use. Choose a different one.'
    );
  });

  it('allows reauth when the supplied nickname already belongs to the same account', async () => {
    const { getCliAuthNicknameError } = await import(
      `../../../src/cliproxy/auth/oauth-handler?cli-nickname-reauth=${Date.now()}`
    );
    const existingAccounts = [
      { id: 'github-ABC123', nickname: 'work' },
      { id: 'amazon-XYZ789', nickname: 'personal' },
    ];

    expect(getCliAuthNicknameError('kiro', 'work', existingAccounts, 'github-ABC123')).toBeNull();
    expect(getCliAuthNicknameError('kiro', 'github-ABC123', existingAccounts, 'github-ABC123')).toBeNull();
  });
});
