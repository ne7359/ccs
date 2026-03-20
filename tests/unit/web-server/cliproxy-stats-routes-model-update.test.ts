import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';

function writeSettings(filePath: string, env: Record<string, string>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ env }, null, 2) + '\n');
}

describe('cliproxy-stats-routes model update canonicalization', () => {
  let server: Server;
  let baseUrl = '';
  let tempHome = '';
  let originalCcsHome: string | undefined;
  let setGlobalConfigDir: (dir: string | undefined) => void;
  let cliproxyStatsRoutes: ReturnType<typeof express.Router>;

  beforeAll(async () => {
    originalCcsHome = process.env.CCS_HOME;
    ({ setGlobalConfigDir } = await import('../../../src/utils/config-manager'));
    ({ default: cliproxyStatsRoutes } = await import(
      '../../../src/web-server/routes/cliproxy-stats-routes'
    ));

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

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setGlobalConfigDir(undefined);

    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }
  });

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-cliproxy-model-route-'));
    process.env.CCS_HOME = tempHome;
    setGlobalConfigDir(path.join(tempHome, '.ccs'));
  });

  afterEach(() => {
    setGlobalConfigDir(undefined);
    delete process.env.CCS_HOME;

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('updates linked tiers while preserving intentionally distinct tier models', async () => {
    const settingsPath = path.join(tempHome, '.ccs', 'cliproxy', 'agy.settings.json');
    writeSettings(settingsPath, {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/agy',
      ANTHROPIC_AUTH_TOKEN: 'ccs-internal-managed',
      ANTHROPIC_MODEL: 'claude-sonnet-4.6-thinking',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-6-thinking',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6-thinking',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
    });

    const response = await fetch(`${baseUrl}/api/cliproxy/models/agy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6-thinking(8192)' }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { model: string };
    expect(body.model).toBe('claude-sonnet-4-6(8192)');

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(persisted.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6(8192)');
    expect(persisted.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-6-thinking');
    expect(persisted.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-6(8192)');
    expect(persisted.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-haiku-4-5');
  });

  it('rejects denylisted AGY 4.5 model updates', async () => {
    const settingsPath = path.join(tempHome, '.ccs', 'cliproxy', 'agy.settings.json');
    writeSettings(settingsPath, {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/agy',
      ANTHROPIC_AUTH_TOKEN: 'ccs-internal-managed',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-6-thinking',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
    });

    const response = await fetch(`${baseUrl}/api/cliproxy/models/agy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4.5' }),
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('denylist');

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(persisted.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6');
  });

  it('canonicalizes Codex effort suffix and syncs linked core model env vars', async () => {
    const settingsPath = path.join(tempHome, '.ccs', 'cliproxy', 'codex.settings.json');
    writeSettings(settingsPath, {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/codex',
      ANTHROPIC_AUTH_TOKEN: 'ccs-internal-managed',
      ANTHROPIC_MODEL: 'gpt-5.3-codex',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.3-codex',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.3-codex',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5-mini',
    });

    const response = await fetch(`${baseUrl}/api/cliproxy/models/codex`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.3-codex-xhigh' }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { model: string };
    expect(body.model).toBe('gpt-5.3-codex');

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(persisted.env.ANTHROPIC_MODEL).toBe('gpt-5.3-codex');
    expect(persisted.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-5.3-codex');
    expect(persisted.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gpt-5.3-codex');
    expect(persisted.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gpt-5-mini');
  });

  it('canonicalizes legacy iflow model IDs to supported upstream IDs', async () => {
    const settingsPath = path.join(tempHome, '.ccs', 'cliproxy', 'iflow.settings.json');
    writeSettings(settingsPath, {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/iflow',
      ANTHROPIC_AUTH_TOKEN: 'ccs-internal-managed',
      ANTHROPIC_MODEL: 'qwen3-coder-plus',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3-coder-plus',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3-coder-plus',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3-coder-plus',
    });

    const response = await fetch(`${baseUrl}/api/cliproxy/models/iflow`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'kimi-k2.5' }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { model: string };
    expect(body.model).toBe('kimi-k2');

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(persisted.env.ANTHROPIC_MODEL).toBe('kimi-k2');
    expect(persisted.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('kimi-k2');
    expect(persisted.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('kimi-k2');
    expect(persisted.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('kimi-k2');
  });
});
