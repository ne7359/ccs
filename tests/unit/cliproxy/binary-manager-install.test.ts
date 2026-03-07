import { afterEach, describe, expect, it, mock } from 'bun:test';

describe('installCliproxyVersion', () => {
  afterEach(() => {
    mock.restore();
  });

  it('attempts to stop the proxy even when there is no tracked running session', async () => {
    const calls = {
      stopProxy: 0,
      waitForPortFree: 0,
      deleteBinary: 0,
      ensureBinary: 0,
    };

    mock.module('../../../src/utils/ui', () => ({
      info: (message: string) => message,
      warn: (message: string) => message,
    }));

    mock.module('../../../src/cliproxy/config-generator', () => ({
      getBinDir: () => '/tmp/ccs-bin',
      CLIPROXY_DEFAULT_PORT: 8317,
    }));

    mock.module('../../../src/cliproxy/platform-detector', () => ({
      DEFAULT_BACKEND: 'plus',
      CLIPROXY_MAX_STABLE_VERSION: '9.9.999-0',
      BACKEND_CONFIG: {
        plus: {
          fallbackVersion: '6.6.80',
          repo: 'router-for-me/CLIProxyAPIPlus',
        },
        original: {
          fallbackVersion: '0.0.0',
          repo: 'router-for-me/CLIProxyAPI',
        },
      },
    }));

    mock.module('../../../src/cliproxy/services/proxy-lifecycle-service', () => ({
      stopProxy: async () => {
        calls.stopProxy += 1;
        return { stopped: false, error: 'No active CLIProxy session found' };
      },
    }));

    mock.module('../../../src/utils/port-utils', () => ({
      waitForPortFree: async () => {
        calls.waitForPortFree += 1;
        return true;
      },
    }));

    mock.module('../../../src/config/unified-config-loader', () => ({
      loadOrCreateUnifiedConfig: () => ({
        cliproxy: { backend: 'plus' },
      }),
    }));

    mock.module('../../../src/cliproxy/binary', () => ({
      checkForUpdates: async () => ({
        hasUpdate: false,
        currentVersion: '6.6.80',
        latestVersion: '6.6.80',
        fromCache: false,
        checkedAt: Date.now(),
      }),
      deleteBinary: () => {
        calls.deleteBinary += 1;
      },
      getBinaryPath: () => '/tmp/ccs-bin/plus/cliproxy',
      isBinaryInstalled: () => false,
      getBinaryInfo: async () => null,
      getPinnedVersion: () => null,
      savePinnedVersion: () => {},
      clearPinnedVersion: () => {},
      isVersionPinned: () => false,
      getVersionPinPath: () => '/tmp/ccs-bin/plus/.version-pin',
      readInstalledVersion: () => '6.6.80',
      ensureBinary: async () => {
        calls.ensureBinary += 1;
        return '/tmp/ccs-bin/plus/cliproxy';
      },
      migrateVersionPin: () => {},
    }));

    const binaryManager = await import(
      `../../../src/cliproxy/binary-manager?binary-manager-install=${Date.now()}`
    );

    await binaryManager.installCliproxyVersion('6.7.1', false, 'plus');

    expect(calls.stopProxy).toBe(1);
    expect(calls.waitForPortFree).toBe(0);
    expect(calls.deleteBinary).toBe(0);
    expect(calls.ensureBinary).toBe(1);
  });
});
