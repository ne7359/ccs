import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

function createTempCcsHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-tool-routes-'));
}

async function startApiServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  const { apiRoutes } = await import('../../../src/web-server/routes/index');
  app.use('/api', apiRoutes);

  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('tool-routes', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;
  let originalDashboardAuth: string | undefined;

  beforeEach(() => {
    tempHome = createTempCcsHome();
    originalCcsHome = process.env.CCS_HOME;
    originalDashboardAuth = process.env.CCS_DASHBOARD_AUTH_ENABLED;
    process.env.CCS_HOME = tempHome;
    delete process.env.CCS_DASHBOARD_AUTH_ENABLED;
  });

  afterEach(() => {
    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
    }

    if (originalDashboardAuth === undefined) {
      delete process.env.CCS_DASHBOARD_AUTH_ENABLED;
    } else {
      process.env.CCS_DASHBOARD_AUTH_ENABLED = originalDashboardAuth;
    }

    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('returns equivalent payloads for generic and legacy copilot routes', async () => {
    const { server, baseUrl } = await startApiServer();

    try {
      const genericResponse = await fetch(`${baseUrl}/api/tools/copilot/config`);
      const legacyResponse = await fetch(`${baseUrl}/api/copilot/config`);

      expect(genericResponse.status).toBe(200);
      expect(legacyResponse.status).toBe(200);

      const genericPayload = (await genericResponse.json()) as Record<string, unknown>;
      const legacyPayload = (await legacyResponse.json()) as Record<string, unknown>;
      expect(genericPayload).toEqual(legacyPayload);
    } finally {
      await stopServer(server);
    }
  });

  it('returns equivalent payloads for generic and legacy cursor routes', async () => {
    const { server, baseUrl } = await startApiServer();

    try {
      const genericResponse = await fetch(`${baseUrl}/api/tools/cursor/status`);
      const legacyResponse = await fetch(`${baseUrl}/api/cursor/status`);

      expect(genericResponse.status).toBe(200);
      expect(legacyResponse.status).toBe(200);

      const genericPayload = (await genericResponse.json()) as Record<string, unknown>;
      const legacyPayload = (await legacyResponse.json()) as Record<string, unknown>;
      expect(genericPayload).toEqual(legacyPayload);
    } finally {
      await stopServer(server);
    }
  });

  it(
    'exposes droid generic config routes',
    async () => {
      const droidConfigPath = path.join(tempHome, '.ccs', 'tools', 'droid', 'config.json');
      fs.mkdirSync(path.dirname(droidConfigPath), { recursive: true });
      fs.writeFileSync(
        droidConfigPath,
        JSON.stringify(
          {
            profile: 'factory',
            endpoint: '',
            apiKey: '',
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );

      const { server, baseUrl } = await startApiServer();

      try {
        const configResponseBefore = await fetch(`${baseUrl}/api/tools/droid/config`);
        expect(configResponseBefore.status).toBe(200);

        const updateResponse = await fetch(`${baseUrl}/api/tools/droid/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: 'factory',
            endpoint: 'https://droid.example.com',
          }),
        });
        expect(updateResponse.status).toBe(200);

        const configResponseAfter = await fetch(`${baseUrl}/api/tools/droid/config`);
        expect(configResponseAfter.status).toBe(200);
        const configPayload = (await configResponseAfter.json()) as {
          profile?: string;
          endpoint?: string;
        };
        expect(configPayload.profile).toBe('factory');
        expect(configPayload.endpoint).toBe('https://droid.example.com');
      } finally {
        await stopServer(server);
      }
    },
    10000
  );

  it('rejects invalid droid endpoint updates via generic route', async () => {
    const { server, baseUrl } = await startApiServer();

    try {
      const updateResponse = await fetch(`${baseUrl}/api/tools/droid/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: 'factory',
          endpoint: 'not-a-url',
        }),
      });

      expect(updateResponse.status).toBe(400);
      const payload = (await updateResponse.json()) as { error?: string };
      expect(payload.error).toContain('valid URL');
    } finally {
      await stopServer(server);
    }
  });

  it('returns 404 for unknown tool IDs', async () => {
    const { server, baseUrl } = await startApiServer();

    try {
      const response = await fetch(`${baseUrl}/api/tools/unknown/status`);
      expect(response.status).toBe(404);

      const payload = (await response.json()) as { error?: string };
      expect(payload.error).toContain('Unknown tool');
    } finally {
      await stopServer(server);
    }
  });

  it('accepts case-insensitive IDs and safely rejects encoded IDs', async () => {
    const { server, baseUrl } = await startApiServer();

    try {
      const upperCaseResponse = await fetch(`${baseUrl}/api/tools/CURSOR/status`);
      const encodedResponse = await fetch(`${baseUrl}/api/tools/%63ursor/status`);

      expect(upperCaseResponse.status).toBe(200);
      expect(encodedResponse.status).toBe(404);

      const upperCasePayload = (await upperCaseResponse.json()) as Record<string, unknown>;
      expect(upperCasePayload).toHaveProperty('authenticated');
      const encodedPayload = (await encodedResponse.json()) as { error?: string };
      expect(encodedPayload.error).toContain("Unknown route for tool 'cursor'");
    } finally {
      await stopServer(server);
    }
  });

  it('enforces required auth mode for tool route bindings', async () => {
    process.env.CCS_DASHBOARD_AUTH_ENABLED = '1';
    const { server, baseUrl } = await startApiServer();

    try {
      const response = await fetch(`${baseUrl}/api/tools/copilot/config`);
      expect(response.status).toBe(401);
    } finally {
      await stopServer(server);
    }
  });
});
