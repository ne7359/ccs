import { describe, expect, it } from 'bun:test';
import { hydrateImageAnalysisRuntimeStatus } from '../../../../src/utils/hooks/image-analysis-runtime-status';
import type { ImageAnalysisStatus } from '../../../../src/utils/hooks/image-analysis-backend-resolver';

function createStatus(overrides: Partial<ImageAnalysisStatus> = {}): ImageAnalysisStatus {
  return {
    enabled: true,
    supported: true,
    status: 'active',
    backendId: 'ghcp',
    backendDisplayName: 'GitHub Copilot (OAuth)',
    model: 'claude-haiku-4.5',
    resolutionSource: 'profile-backend',
    reason: null,
    shouldPersistHook: true,
    persistencePath: '/tmp/orq.settings.json',
    runtimePath: '/api/provider/ghcp',
    usesCurrentTarget: true,
    usesCurrentAuthToken: true,
    hookInstalled: true,
    sharedHookInstalled: true,
    authReadiness: 'unknown',
    authProvider: 'ghcp',
    authDisplayName: 'GitHub Copilot (OAuth)',
    authReason: 'Auth readiness has not been verified yet.',
    proxyReadiness: 'unknown',
    proxyReason: 'CLIProxy runtime readiness has not been verified yet.',
    effectiveRuntimeMode: 'native-read',
    effectiveRuntimeReason: null,
    profileModel: 'claude-haiku-4.5',
    nativeReadPreference: false,
    nativeImageCapable: true,
    nativeImageReason: 'claude-haiku-4.5 can read images natively.',
    ...overrides,
  };
}

describe('image-analysis-runtime-status', () => {
  it('falls back to native read when provider auth is missing', async () => {
    const status = await hydrateImageAnalysisRuntimeStatus(createStatus(), {
      getProxyTarget: () => ({
        host: '127.0.0.1',
        port: 8317,
        protocol: 'http',
        isRemote: false,
      }),
      initializeAccounts: () => {},
      getAuthStatus: () => ({
        provider: 'ghcp',
        authenticated: false,
        tokenDir: '/tmp/auth',
        tokenFiles: [],
        accounts: [],
        defaultAccount: undefined,
      }),
      isCliproxyRunning: async () => true,
    });

    expect(status.authReadiness).toBe('missing');
    expect(status.effectiveRuntimeMode).toBe('native-read');
    expect(status.effectiveRuntimeReason).toContain('ccs ghcp --auth');
  });

  it('marks an idle local proxy as launchable when auth is ready', async () => {
    const status = await hydrateImageAnalysisRuntimeStatus(createStatus(), {
      getProxyTarget: () => ({
        host: '127.0.0.1',
        port: 8317,
        protocol: 'http',
        isRemote: false,
      }),
      initializeAccounts: () => {},
      getAuthStatus: () => ({
        provider: 'ghcp',
        authenticated: true,
        tokenDir: '/tmp/auth',
        tokenFiles: ['github-copilot-test.json'],
        accounts: [],
        defaultAccount: undefined,
      }),
      isCliproxyRunning: async () => false,
    });

    expect(status.authReadiness).toBe('ready');
    expect(status.proxyReadiness).toBe('stopped');
    expect(status.effectiveRuntimeMode).toBe('cliproxy-image-analysis');
  });

  it('treats an unreachable remote proxy as unavailable', async () => {
    const status = await hydrateImageAnalysisRuntimeStatus(createStatus(), {
      getProxyTarget: () => ({
        host: 'remote.example',
        port: 443,
        protocol: 'https',
        authToken: 'token',
        managementKey: 'secret',
        isRemote: true,
      }),
      fetchRemoteAuthStatus: async () => [
        {
          provider: 'ghcp',
          displayName: 'GitHub Copilot (OAuth)',
          authenticated: true,
          tokenFiles: 1,
          accounts: [],
          defaultAccount: null,
          source: 'remote',
        },
      ],
      isCliproxyRunning: async () => false,
    });

    expect(status.authReadiness).toBe('ready');
    expect(status.proxyReadiness).toBe('unavailable');
    expect(status.effectiveRuntimeMode).toBe('native-read');
    expect(status.effectiveRuntimeReason).toContain('remote.example:443');
  });

  it('keeps hook-missing on native read even when auth and proxy are ready', async () => {
    const status = await hydrateImageAnalysisRuntimeStatus(
      createStatus({
        status: 'hook-missing',
        reason: 'Profile hook is missing from the persisted settings file.',
      }),
      {
        getProxyTarget: () => ({
          host: '127.0.0.1',
          port: 8317,
          protocol: 'http',
          isRemote: false,
        }),
        initializeAccounts: () => {},
        getAuthStatus: () => ({
          provider: 'ghcp',
          authenticated: true,
          tokenDir: '/tmp/auth',
          tokenFiles: ['github-copilot-test.json'],
          accounts: [],
          defaultAccount: undefined,
        }),
        isCliproxyRunning: async () => true,
      }
    );

    expect(status.authReadiness).toBe('ready');
    expect(status.proxyReadiness).toBe('ready');
    expect(status.effectiveRuntimeMode).toBe('native-read');
    expect(status.effectiveRuntimeReason).toContain('Profile hook is missing');
  });
});
