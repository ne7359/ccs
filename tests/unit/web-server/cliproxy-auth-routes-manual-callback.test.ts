import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { Server } from 'http';
import cliproxyAuthRoutes from '../../../src/web-server/routes/cliproxy-auth-routes';
import { restoreFetch, mockFetch } from '../../mocks';

describe('cliproxy-auth-routes manual callback nickname persistence', () => {
  let server: Server;
  let baseUrl = '';
  let tempHome = '';
  let originalCcsHome: string | undefined;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/cliproxy/auth', cliproxyAuthRoutes);

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
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-cliproxy-manual-callback-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    restoreFetch();

    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
    }

    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  async function postJson(route: string, body: Record<string, unknown>) {
    return await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const payload = JSON.stringify(body);
      const url = new URL(`${baseUrl}${route}`);
      const request = http.request(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (response) => {
          let responseBody = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            responseBody += chunk;
          });
          response.on('end', () => {
            resolve({
              status: response.statusCode || 0,
              body: responseBody ? JSON.parse(responseBody) : null,
            });
          });
        }
      );

      request.on('error', reject);
      request.write(payload);
      request.end();
    });
  }

  it('persists the supplied nickname for Kiro social start-url flows after callback submission', async () => {
    mockFetch([
      {
        url: /\/v0\/management\/kiro-auth-url\?is_webui=true&method=google$/,
        response: {
          auth_url: 'https://auth.example.com/authorize?state=state-123',
          state: 'state-123',
        },
      },
      {
        url: /\/v0\/management\/oauth-callback$/,
        method: 'POST',
        response: { status: 'ok' },
      },
    ]);

    const startResponse = await postJson('/api/cliproxy/auth/kiro/start-url', {
        nickname: 'work',
        kiroMethod: 'google',
      });
    expect(startResponse.status).toBe(200);

    const tokenDir = path.join(tempHome, '.ccs', 'cliproxy', 'auth');
    fs.mkdirSync(tokenDir, { recursive: true });
    fs.writeFileSync(
      path.join(tokenDir, 'kiro-github-ABC123.json'),
      JSON.stringify({ type: 'kiro' }),
      'utf8'
    );

    const callbackResponse = await postJson('/api/cliproxy/auth/kiro/submit-callback', {
        redirectUrl: 'http://localhost/callback?code=abc123&state=state-123',
      });

    expect(callbackResponse.status).toBe(200);

    const registryPath = path.join(tempHome, '.ccs', 'cliproxy', 'accounts.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
      providers: {
        kiro: {
          accounts: Record<string, { nickname?: string }>;
        };
      };
    };

    expect(registry.providers.kiro.accounts['github-ABC123']?.nickname).toBe('work');
  });
});
