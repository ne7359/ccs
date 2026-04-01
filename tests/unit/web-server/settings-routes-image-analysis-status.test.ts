import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';
import settingsRoutes from '../../../src/web-server/routes/settings-routes';

function writeJson(filePath: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function installSharedHook(tempHome: string): string {
  const hookPath = path.join(tempHome, '.ccs', 'hooks', 'image-analyzer-transformer.cjs');
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, '#!/usr/bin/env node\n', 'utf8');
  return hookPath;
}

function writeProfileSettings(
  tempHome: string,
  profileName: string,
  env: Record<string, string>,
  settingsPath = path.join(tempHome, '.ccs', `${profileName}.settings.json`)
): string {
  const hookPath = installSharedHook(tempHome);
  writeJson(settingsPath, {
    env,
    hooks: {
      PreToolUse: [
        {
          matcher: 'Read',
          hooks: [{ type: 'command', command: `node "${hookPath}"`, timeout: 65000 }],
        },
      ],
    },
  });
  return settingsPath;
}

describe('settings-routes image-analysis status', () => {
  let server: Server;
  let baseUrl = '';
  let tempHome = '';
  let originalCcsHome: string | undefined;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRoutes);

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
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-image-status-routes-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }

    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns fallback-backed image analysis status for settings profiles', async () => {
    writeProfileSettings(tempHome, 'glm', {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
      ANTHROPIC_API_KEY: 'glm-test-key',
    });

    const response = await fetch(`${baseUrl}/api/settings/glm/raw`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      imageAnalysisStatus: {
        status: string;
        backendId: string | null;
        resolutionSource: string;
        model: string | null;
        persistencePath: string | null;
        authReadiness: string;
        effectiveRuntimeMode: string;
      };
    };

    expect(body.imageAnalysisStatus.status).toBe('active');
    expect(body.imageAnalysisStatus.backendId).toBe('gemini');
    expect(body.imageAnalysisStatus.resolutionSource).toBe('fallback-backend');
    expect(body.imageAnalysisStatus.model).toBe('gemini-3-flash-preview');
    expect(body.imageAnalysisStatus.persistencePath).toContain('glm.settings.json');
    expect(body.imageAnalysisStatus.authReadiness).toBe('missing');
    expect(body.imageAnalysisStatus.effectiveRuntimeMode).toBe('native-read');
  });

  it('keeps direct Anthropic settings profiles on native read diagnostics', async () => {
    writeJson(path.join(tempHome, '.ccs', 'claude-direct.settings.json'), {
      env: {
        ANTHROPIC_API_KEY: 'anthropic-test-key',
      },
    });

    const response = await fetch(`${baseUrl}/api/settings/claude-direct/raw`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      imageAnalysisStatus: {
        status: string;
        backendId: string | null;
        shouldPersistHook: boolean;
        runtimePath: string | null;
        reason: string | null;
        authReadiness: string;
        proxyReadiness: string;
      };
    };

    expect(body.imageAnalysisStatus.status).toBe('skipped');
    expect(body.imageAnalysisStatus.backendId).toBeNull();
    expect(body.imageAnalysisStatus.shouldPersistHook).toBe(false);
    expect(body.imageAnalysisStatus.runtimePath).toBeNull();
    expect(body.imageAnalysisStatus.reason).toContain('native file access');
    expect(body.imageAnalysisStatus.authReadiness).toBe('not-needed');
    expect(body.imageAnalysisStatus.proxyReadiness).toBe('not-needed');
  });

  it('returns explicit mapped status for custom aliases', async () => {
    writeJson(path.join(tempHome, '.ccs', 'config.yaml'), {
      version: 11,
      image_analysis: {
        enabled: true,
        timeout: 60,
        provider_models: {
          gemini: 'gemini-2.5-flash',
          ghcp: 'claude-haiku-4.5',
        },
        profile_backends: {
          orq: 'copilot',
        },
      },
    });
    writeProfileSettings(tempHome, 'orq', {
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
      ANTHROPIC_API_KEY: 'orq-test-key',
    });

    const response = await fetch(`${baseUrl}/api/settings/orq/raw`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      imageAnalysisStatus: {
        status: string;
        backendId: string | null;
        resolutionSource: string;
        model: string | null;
        authReadiness: string;
        effectiveRuntimeMode: string;
      };
    };

    expect(body.imageAnalysisStatus.status).toBe('mapped');
    expect(body.imageAnalysisStatus.backendId).toBe('ghcp');
    expect(body.imageAnalysisStatus.resolutionSource).toBe('profile-backend');
    expect(body.imageAnalysisStatus.model).toBe('claude-haiku-4.5');
    expect(body.imageAnalysisStatus.authReadiness).toBe('missing');
    expect(body.imageAnalysisStatus.effectiveRuntimeMode).toBe('native-read');
  });

  it('uses the configured custom settings path for status and persistence diagnostics', async () => {
    const customSettingsPath = path.join(tempHome, 'profiles', 'foo.bar.settings.json');
    writeJson(path.join(tempHome, '.ccs', 'config.json'), {
      profiles: {
        'foo.bar': customSettingsPath,
      },
    });
    writeProfileSettings(
      tempHome,
      'foo.bar',
      {
        ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
        ANTHROPIC_API_KEY: 'glm-test-key',
      },
      customSettingsPath
    );

    const response = await fetch(`${baseUrl}/api/settings/foo.bar/raw`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      path: string;
      imageAnalysisStatus: {
        persistencePath: string | null;
        hookInstalled: boolean | null;
      };
    };

    expect(body.path).toBe(customSettingsPath);
    expect(body.imageAnalysisStatus.persistencePath).toBe(customSettingsPath);
    expect(body.imageAnalysisStatus.hookInstalled).toBe(true);
  });

  it('previews image-analysis status from unsaved editor settings', async () => {
    writeProfileSettings(tempHome, 'glm', {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
      ANTHROPIC_API_KEY: 'glm-test-key',
    });

    const response = await fetch(`${baseUrl}/api/settings/glm/image-analysis-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          env: {
            ANTHROPIC_BASE_URL: 'https://proxy.example/api/provider/ghcp',
            ANTHROPIC_AUTH_TOKEN: 'preview-token',
          },
        },
      }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      imageAnalysisStatus: {
        backendId: string | null;
        resolutionSource: string;
        authReadiness: string;
      };
    };

    expect(body.imageAnalysisStatus.backendId).toBe('ghcp');
    expect(body.imageAnalysisStatus.resolutionSource).toBe('cliproxy-bridge');
    expect(body.imageAnalysisStatus.authReadiness).toBe('missing');
  });

  it('respects per-profile native image preference stored in settings json', async () => {
    writeJson(path.join(tempHome, '.ccs', 'glmv.settings.json'), {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
        ANTHROPIC_MODEL: 'glm-4.5v',
        ANTHROPIC_AUTH_TOKEN: 'glmv-test-key',
      },
      ccs_image: {
        native_read: true,
      },
    });

    const response = await fetch(`${baseUrl}/api/settings/glmv/raw`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      imageAnalysisStatus: {
        backendId: string | null;
        resolutionSource: string;
        profileModel: string | null;
        nativeReadPreference: boolean;
        nativeImageCapable: boolean | null;
        effectiveRuntimeMode: string;
      };
    };

    expect(body.imageAnalysisStatus.backendId).toBeNull();
    expect(body.imageAnalysisStatus.resolutionSource).toBe('native-compatible');
    expect(body.imageAnalysisStatus.profileModel).toBe('glm-4.5v');
    expect(body.imageAnalysisStatus.nativeReadPreference).toBe(true);
    expect(body.imageAnalysisStatus.nativeImageCapable).toBe(true);
    expect(body.imageAnalysisStatus.effectiveRuntimeMode).toBe('native-read');
  });
});
