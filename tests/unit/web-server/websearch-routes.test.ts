import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';
import { loadOrCreateUnifiedConfig, mutateUnifiedConfig } from '../../../src/config/unified-config-loader';
import websearchRoutes from '../../../src/web-server/routes/websearch-routes';

const WEBSEARCH_ENV_KEYS = [
  'EXA_API_KEY',
  'TAVILY_API_KEY',
  'BRAVE_API_KEY',
  'CCS_WEBSEARCH_EXA_API_KEY',
  'CCS_WEBSEARCH_TAVILY_API_KEY',
  'CCS_WEBSEARCH_BRAVE_API_KEY',
] as const;

describe('websearch routes', () => {
  let server: Server;
  let baseUrl = '';
  let tempHome: string;
  let originalCcsHome: string | undefined;
  let originalEnvValues: Record<(typeof WEBSEARCH_ENV_KEYS)[number], string | undefined>;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/websearch', websearchRoutes);

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

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-websearch-routes-test-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;

    originalEnvValues = WEBSEARCH_ENV_KEYS.reduce(
      (acc, key) => {
        acc[key] = process.env[key];
        delete process.env[key];
        return acc;
      },
      {} as Record<(typeof WEBSEARCH_ENV_KEYS)[number], string | undefined>
    );
  });

  afterEach(() => {
    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }

    for (const key of WEBSEARCH_ENV_KEYS) {
      const value = originalEnvValues[key];
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('returns masked API key state from dashboard-managed global env', async () => {
    mutateUnifiedConfig((config) => {
      config.websearch = {
        enabled: true,
        providers: {
          ...config.websearch?.providers,
          exa: { enabled: true, max_results: 7 },
          duckduckgo: { enabled: false, max_results: 5 },
        },
      };
      config.global_env = {
        enabled: true,
        env: {
          ...(config.global_env?.env ?? {}),
          EXA_API_KEY: 'exa-secret-12345678',
        },
      };
    });

    const response = await fetch(`${baseUrl}/api/websearch`);
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.providers.exa).toMatchObject({
      enabled: true,
      max_results: 7,
    });
    expect(payload.apiKeys.exa).toMatchObject({
      envVar: 'EXA_API_KEY',
      configured: true,
      available: true,
      source: 'global_env',
    });
    expect(payload.apiKeys.exa.maskedValue).toContain('*');

    const statusResponse = await fetch(`${baseUrl}/api/websearch/status`);
    expect(statusResponse.status).toBe(200);
    const statusPayload = await statusResponse.json();
    expect(statusPayload.readiness).toMatchObject({
      status: 'ready',
    });
    expect(statusPayload.providers.find((provider: { id: string }) => provider.id === 'exa')).toMatchObject({
      available: true,
      detail: 'API key detected (7 results)',
    });
  });

  it('stores and removes WebSearch API keys via the dashboard route', async () => {
    const createResponse = await fetch(`${baseUrl}/api/websearch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: {
          exa: { enabled: true, max_results: 6 },
        },
        apiKeys: {
          exa: 'exa-secret-abcdefgh',
        },
      }),
    });

    expect(createResponse.status).toBe(200);
    const createdPayload = await createResponse.json();
    expect(createdPayload.websearch.apiKeys.exa).toMatchObject({
      configured: true,
      source: 'global_env',
    });

    let config = loadOrCreateUnifiedConfig();
    expect(config.global_env?.env.EXA_API_KEY).toBe('exa-secret-abcdefgh');

    const removeResponse = await fetch(`${baseUrl}/api/websearch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: {
          exa: { enabled: true, max_results: 6 },
        },
        apiKeys: {
          exa: '',
        },
      }),
    });

    expect(removeResponse.status).toBe(200);
    const removedPayload = await removeResponse.json();
    expect(removedPayload.websearch.apiKeys.exa).toMatchObject({
      configured: false,
      source: 'none',
    });

    config = loadOrCreateUnifiedConfig();
    expect(config.global_env?.env.EXA_API_KEY).toBeUndefined();
  });

  it('preserves stored API keys when only provider settings change', async () => {
    mutateUnifiedConfig((config) => {
      config.global_env = {
        enabled: true,
        env: {
          ...(config.global_env?.env ?? {}),
          EXA_API_KEY: 'exa-secret-12345678',
        },
      };
    });

    const response = await fetch(`${baseUrl}/api/websearch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: {
          exa: { enabled: true, max_results: 9 },
          duckduckgo: { enabled: false, max_results: 5 },
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.websearch.providers.exa).toMatchObject({
      enabled: true,
      max_results: 9,
    });
    expect(payload.websearch.apiKeys.exa).toMatchObject({
      configured: true,
      source: 'global_env',
    });

    const config = loadOrCreateUnifiedConfig();
    expect(config.global_env?.env.EXA_API_KEY).toBe('exa-secret-12345678');
  });
});
