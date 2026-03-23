/**
 * Cursor Settings Routes - Settings editor and raw settings for Cursor IDE
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { getCcsDir } from '../../utils/config-manager';
import { DEFAULT_CURSOR_CONFIG } from '../../config/unified-config-types';
import { mutateUnifiedConfig, getCursorConfig } from '../../config/unified-config-loader';
import type { CursorConfig } from '../../config/unified-config-types';

const router = Router();

function parseLocalCursorPort(settings: unknown): number | null {
  if (typeof settings !== 'object' || settings === null) return null;
  const env = (settings as { env?: unknown }).env;
  if (typeof env !== 'object' || env === null) return null;
  const baseUrl = (env as { ANTHROPIC_BASE_URL?: unknown }).ANTHROPIC_BASE_URL;
  if (typeof baseUrl !== 'string' || !baseUrl) return null;

  try {
    const parsed = new URL(baseUrl);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return null;
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return port;
  } catch {
    return null;
  }
}

function parseRequiredModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getDefaultCursorSettings(cursorConfig: CursorConfig): { env: Record<string, string> } {
  const model = cursorConfig.model || DEFAULT_CURSOR_CONFIG.model;
  return {
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${cursorConfig.port}`,
      ANTHROPIC_AUTH_TOKEN: 'cursor-managed',
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: cursorConfig.opus_model || model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: cursorConfig.sonnet_model || model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: cursorConfig.haiku_model || model,
    },
  };
}

async function syncRawSettingsFromCursorConfig(cursorConfig: CursorConfig): Promise<void> {
  const settingsPath = path.join(getCcsDir(), 'cursor.settings.json');

  let settings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await fsp.readFile(settingsPath, 'utf-8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      settings = parsed as Record<string, unknown>;
    }
  } catch {
    settings = {};
  }

  const envSource = settings.env;
  const env =
    typeof envSource === 'object' && envSource !== null && !Array.isArray(envSource)
      ? { ...(envSource as Record<string, string>) }
      : {};

  const model = cursorConfig.model || DEFAULT_CURSOR_CONFIG.model;
  const localPort = parseLocalCursorPort({ env });
  if (!env.ANTHROPIC_BASE_URL || localPort !== null) {
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${cursorConfig.port}`;
  }
  if (!env.ANTHROPIC_AUTH_TOKEN) {
    env.ANTHROPIC_AUTH_TOKEN = 'cursor-managed';
  }
  env.ANTHROPIC_MODEL = model;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = cursorConfig.opus_model || model;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = cursorConfig.sonnet_model || model;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = cursorConfig.haiku_model || model;

  const nextSettings = {
    ...settings,
    env,
  };

  const tempPath = settingsPath + '.tmp';
  await fsp.writeFile(tempPath, JSON.stringify(nextSettings, null, 2) + '\n');
  await fsp.rename(tempPath, settingsPath);
}

/**
 * GET /api/cursor/settings - Get cursor config
 */
router.get('/', (_req: Request, res: Response): void => {
  try {
    const cursorConfig = getCursorConfig();
    res.json(cursorConfig);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/cursor/settings - Update cursor config
 */
router.put('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const updates = req.body;

    // Reject non-object bodies
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      res.status(400).json({ error: 'Request body must be a JSON object' });
      return;
    }

    // Validate input types
    if ('port' in updates) {
      if (typeof updates.port !== 'number' || !Number.isInteger(updates.port)) {
        res.status(400).json({ error: 'port must be an integer' });
        return;
      }
      if (updates.port < 1 || updates.port > 65535) {
        res.status(400).json({ error: 'port must be between 1 and 65535' });
        return;
      }
    }
    if ('enabled' in updates && typeof updates.enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    if ('auto_start' in updates && typeof updates.auto_start !== 'boolean') {
      res.status(400).json({ error: 'auto_start must be a boolean' });
      return;
    }
    if ('ghost_mode' in updates && typeof updates.ghost_mode !== 'boolean') {
      res.status(400).json({ error: 'ghost_mode must be a boolean' });
      return;
    }
    if ('model' in updates && !parseRequiredModel(updates.model)) {
      res.status(400).json({ error: 'model must be a non-empty string' });
      return;
    }
    if (
      'opus_model' in updates &&
      updates.opus_model !== undefined &&
      updates.opus_model !== null &&
      typeof updates.opus_model !== 'string'
    ) {
      res.status(400).json({ error: 'opus_model must be a string' });
      return;
    }
    if (
      'sonnet_model' in updates &&
      updates.sonnet_model !== undefined &&
      updates.sonnet_model !== null &&
      typeof updates.sonnet_model !== 'string'
    ) {
      res.status(400).json({ error: 'sonnet_model must be a string' });
      return;
    }
    if (
      'haiku_model' in updates &&
      updates.haiku_model !== undefined &&
      updates.haiku_model !== null &&
      typeof updates.haiku_model !== 'string'
    ) {
      res.status(400).json({ error: 'haiku_model must be a string' });
      return;
    }

    const normalizedModel = parseRequiredModel(updates.model);
    const config = mutateUnifiedConfig((currentConfig) => {
      currentConfig.cursor = {
        enabled: updates.enabled ?? currentConfig.cursor?.enabled ?? DEFAULT_CURSOR_CONFIG.enabled,
        port: updates.port ?? currentConfig.cursor?.port ?? DEFAULT_CURSOR_CONFIG.port,
        auto_start:
          updates.auto_start ??
          currentConfig.cursor?.auto_start ??
          DEFAULT_CURSOR_CONFIG.auto_start,
        ghost_mode:
          updates.ghost_mode ??
          currentConfig.cursor?.ghost_mode ??
          DEFAULT_CURSOR_CONFIG.ghost_mode,
        model: normalizedModel ?? currentConfig.cursor?.model ?? DEFAULT_CURSOR_CONFIG.model,
        opus_model:
          'opus_model' in updates
            ? parseOptionalModel(updates.opus_model)
            : currentConfig.cursor?.opus_model,
        sonnet_model:
          'sonnet_model' in updates
            ? parseOptionalModel(updates.sonnet_model)
            : currentConfig.cursor?.sonnet_model,
        haiku_model:
          'haiku_model' in updates
            ? parseOptionalModel(updates.haiku_model)
            : currentConfig.cursor?.haiku_model,
      };
    });

    const cursorConfig = config.cursor ?? DEFAULT_CURSOR_CONFIG;
    await syncRawSettingsFromCursorConfig(cursorConfig);
    res.json({ success: true, cursor: cursorConfig });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/cursor/settings/raw - Get raw cursor.settings.json
 * Returns the raw JSON content for editing in the code editor
 */
router.get('/raw', (_req: Request, res: Response): void => {
  try {
    const settingsPath = path.join(getCcsDir(), 'cursor.settings.json');
    const cursorConfig = getCursorConfig();

    // If file doesn't exist, return default structure
    if (!fs.existsSync(settingsPath)) {
      const defaultSettings = getDefaultCursorSettings(cursorConfig);

      res.json({
        settings: defaultSettings,
        mtime: Date.now(),
        path: '~/.ccs/cursor.settings.json',
        exists: false,
      });
      return;
    }

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const stat = fs.statSync(settingsPath);

    res.json({
      settings,
      mtime: stat.mtimeMs,
      path: '~/.ccs/cursor.settings.json',
      exists: true,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/cursor/settings/raw - Save raw cursor.settings.json
 * Saves the raw JSON content from the code editor
 */
router.put('/raw', (req: Request, res: Response): void => {
  try {
    const { settings, expectedMtime } = req.body;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      res.status(400).json({ error: 'settings must be a JSON object' });
      return;
    }

    const settingsPath = path.join(getCcsDir(), 'cursor.settings.json');

    // For existing files, expectedMtime is required to prevent blind overwrite races.
    if (fs.existsSync(settingsPath)) {
      const stat = fs.statSync(settingsPath);
      if (typeof expectedMtime !== 'number' || !Number.isFinite(expectedMtime)) {
        res.status(409).json({
          error: 'File metadata not loaded. Refresh and retry.',
          mtime: stat.mtimeMs,
        });
        return;
      }

      if (Math.abs(stat.mtimeMs - expectedMtime) > 1000) {
        res.status(409).json({ error: 'File modified externally', mtime: stat.mtimeMs });
        return;
      }
    }

    // Write settings file atomically
    const tempPath = settingsPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tempPath, settingsPath);

    // Keep unified config aligned with raw settings edits (parity with Copilot raw editor).
    const parsedPort = parseLocalCursorPort(settings);
    const env = (settings as { env?: Record<string, unknown> }).env ?? {};
    mutateUnifiedConfig((config) => {
      const model = parseRequiredModel(env.ANTHROPIC_MODEL) ?? config.cursor?.model;

      config.cursor = {
        ...(config.cursor ?? DEFAULT_CURSOR_CONFIG),
        ...(parsedPort !== null ? { port: parsedPort } : {}),
        ...(model ? { model } : {}),
        opus_model: parseOptionalModel(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
        sonnet_model: parseOptionalModel(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
        haiku_model: parseOptionalModel(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
      };
    });

    const stat = fs.statSync(settingsPath);
    res.json({ success: true, mtime: stat.mtimeMs });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
