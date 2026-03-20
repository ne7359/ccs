import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import express from 'express';
import type { Server } from 'http';

const installSpy = {
  calls: 0,
};

mock.module('../../../src/config/unified-config-loader', () => ({
  isUnifiedMode: () => true,
  loadUnifiedConfig: () => ({
    cliproxy: { backend: 'plus' },
  }),
  loadOrCreateUnifiedConfig: () => ({
    cliproxy: { backend: 'plus' },
  }),
  getGlobalEnvConfig: () => ({}),
  getThinkingConfig: () => ({
    mode: 'auto',
    tier_defaults: {
      opus: 'high',
      sonnet: 'high',
      haiku: 'medium',
    },
    provider_overrides: {},
    show_warnings: true,
  }),
  getCliproxySafetyConfig: () => ({
    antigravity_ack_bypass: false,
  }),
  saveUnifiedConfig: () => {},
}));

mock.module('../../../src/cliproxy/binary-manager', () => ({
  ensureCLIProxyBinary: async () => '/tmp/cliproxy',
  isCLIProxyInstalled: () => true,
  getCLIProxyPath: () => '/tmp/cliproxy',
  checkCliproxyUpdate: async () => ({
    hasUpdate: false,
    currentVersion: '6.6.80',
    latestVersion: '6.6.89',
    fromCache: false,
    checkedAt: Date.now(),
    backend: 'plus',
    backendLabel: 'CLIProxy Plus',
    isStable: true,
    maxStableVersion: '9.9.999-0',
  }),
  getInstalledCliproxyVersion: () => '6.6.80',
  installCliproxyVersion: async () => {},
  fetchLatestCliproxyVersion: async () => '6.6.89',
}));

mock.module('../../../src/cliproxy/binary/version-checker', () => ({
  fetchAllVersions: async () => ({
    versions: ['6.6.89', '6.6.88', '6.6.81', '6.6.80'],
    latestStable: '6.6.89',
    latest: '6.6.89',
    fromCache: false,
    checkedAt: Date.now(),
  }),
  isNewerVersion: (version: string, maxStable: string) => {
    const normalize = (value: string) => value.replace(/-\d+$/, '').split('.').map(Number);
    const versionParts = normalize(version);
    const maxStableParts = normalize(maxStable);

    for (let index = 0; index < 3; index += 1) {
      const versionPart = versionParts[index] || 0;
      const maxStablePart = maxStableParts[index] || 0;

      if (versionPart > maxStablePart) return true;
      if (versionPart < maxStablePart) return false;
    }

    return false;
  },
  isVersionFaulty: (version: string) =>
    ['6.6.81', '6.6.82', '6.6.83', '6.6.84', '6.6.85', '6.6.86', '6.6.87', '6.6.88'].includes(
      version
    ),
}));

mock.module('../../../src/web-server/services/cliproxy-dashboard-install-service', () => ({
  installDashboardCliproxyVersion: async () => {
    installSpy.calls += 1;
    return {
      success: true,
      restarted: true,
      port: 8317,
      message: 'installed',
    };
  },
}));

let cliproxyStatsRoutes: typeof import('../../../src/web-server/routes/cliproxy-stats-routes').default;
let server: Server;
let baseUrl = '';

beforeAll(async () => {
  cliproxyStatsRoutes = (await import('../../../src/web-server/routes/cliproxy-stats-routes'))
    .default;

  const app = express();
  app.use(express.json());
  app.use('/api/cliproxy', cliproxyStatsRoutes);

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1');
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  installSpy.calls = 0;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  mock.restore();
});

describe('cliproxy-stats-routes install contract', () => {
  it('returns faultyRange in the versions response', async () => {
    const response = await fetch(`${baseUrl}/api/cliproxy/versions`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      faultyRange: { min: string; max: string };
      currentVersion: string;
    };
    expect(body.currentVersion).toBe('6.6.80');
    expect(body.faultyRange).toEqual({ min: '6.6.81-0', max: '6.6.88-0' });
  });

  it('returns faulty confirmation metadata without calling the installer', async () => {
    const response = await fetch(`${baseUrl}/api/cliproxy/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '6.6.81' }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      requiresConfirmation: boolean;
      isFaulty: boolean;
      isExperimental: boolean;
      message: string;
    };
    expect(body.success).toBe(false);
    expect(body.requiresConfirmation).toBe(true);
    expect(body.isFaulty).toBe(true);
    expect(body.isExperimental).toBe(false);
    expect(body.message).toContain('known bugs');
    expect(installSpy.calls).toBe(0);
  });

  it('returns experimental confirmation metadata without calling the installer', async () => {
    const response = await fetch(`${baseUrl}/api/cliproxy/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '10.0.0' }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      requiresConfirmation: boolean;
      isFaulty: boolean;
      isExperimental: boolean;
      message: string;
    };
    expect(body.success).toBe(false);
    expect(body.requiresConfirmation).toBe(true);
    expect(body.isFaulty).toBe(false);
    expect(body.isExperimental).toBe(true);
    expect(body.message).toContain('experimental');
    expect(installSpy.calls).toBe(0);
  });
});
