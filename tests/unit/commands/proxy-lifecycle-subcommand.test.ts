import { afterEach, describe, expect, it, mock } from 'bun:test';
import { CLIPROXY_DEFAULT_PORT } from '../../../src/cliproxy/config/port-manager';

type MockUnifiedConfig = {
  cliproxy_server?: {
    local?: {
      port?: number;
    };
  };
};

function mockUnifiedConfig(config: MockUnifiedConfig): void {
  mock.module('../../../src/config/unified-config-loader', () => ({
    loadOrCreateUnifiedConfig: () => config,
  }));
}

async function loadResolveLifecyclePort() {
  const mod = await import(
    `../../../src/commands/cliproxy/resolve-lifecycle-port?proxy-lifecycle-port=${Date.now()}-${Math.random()}`
  );
  return mod.resolveLifecyclePort;
}

describe('resolveLifecyclePort', () => {
  afterEach(() => {
    mock.restore();
  });

  it('uses configured cliproxy_server.local.port', async () => {
    mockUnifiedConfig({
      cliproxy_server: {
        local: {
          port: 9456,
        },
      },
    });

    const resolveLifecyclePort = await loadResolveLifecyclePort();
    expect(resolveLifecyclePort()).toBe(9456);
  });

  it('falls back to default port when configured local port is invalid', async () => {
    mockUnifiedConfig({
      cliproxy_server: {
        local: {
          port: 70000,
        },
      },
    });

    const resolveLifecyclePort = await loadResolveLifecyclePort();
    expect(resolveLifecyclePort()).toBe(CLIPROXY_DEFAULT_PORT);
  });

  it('falls back to default port when config file is missing', async () => {
    mockUnifiedConfig({});

    const resolveLifecyclePort = await loadResolveLifecyclePort();
    expect(resolveLifecyclePort()).toBe(CLIPROXY_DEFAULT_PORT);
  });
});
