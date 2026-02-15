import type { Request, Response } from 'express';
import { Router } from 'express';
import {
  checkDroidHealth,
  createDefaultDroidConfig,
  readDroidConfig,
  validateDroidEndpoint,
  writeDroidConfigAtomic,
  type DroidConfig,
} from '../../tools/adapters/droid-config';

const router = Router();

interface DroidConfigPayload {
  endpoint?: unknown;
  profile?: unknown;
  apiKey?: unknown;
  clearApiKey?: unknown;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildConfigUpdate(
  existing: DroidConfig,
  payload: DroidConfigPayload
): { config: DroidConfig; errors: string[] } {
  const errors: string[] = [];
  const endpointInput = payload.endpoint;
  const profileInput = payload.profile;
  const apiKeyInput = payload.apiKey;
  const clearApiKey = payload.clearApiKey === true;

  let endpoint = existing.endpoint;
  let profile = existing.profile;
  let apiKey = existing.apiKey;

  if (endpointInput !== undefined) {
    const endpointValue = asNonEmptyString(endpointInput);
    if (!endpointValue) {
      errors.push('endpoint must be a non-empty string');
    } else {
      const endpointError = validateDroidEndpoint(endpointValue);
      if (endpointError) {
        errors.push(endpointError);
      } else {
        endpoint = endpointValue;
      }
    }
  }

  if (profileInput !== undefined) {
    const profileValue = asNonEmptyString(profileInput);
    if (!profileValue) {
      errors.push('profile must be a non-empty string');
    } else {
      profile = profileValue;
    }
  }

  if (apiKeyInput !== undefined) {
    if (typeof apiKeyInput !== 'string') {
      errors.push('apiKey must be a string');
    } else {
      apiKey = apiKeyInput.trim();
    }
  } else if (clearApiKey) {
    apiKey = '';
  }

  return {
    errors,
    config: {
      endpoint: endpoint.trim() || createDefaultDroidConfig().endpoint,
      profile: profile.trim() || createDefaultDroidConfig().profile,
      apiKey,
      updatedAt: new Date().toISOString(),
    },
  };
}

router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await readDroidConfig();
    const health = await checkDroidHealth(config);
    res.json({
      healthy: health.healthy,
      checks: health.checks,
      details: health.details,
      config: {
        endpoint: config.endpoint,
        profile: config.profile,
        apiKeyConfigured: config.apiKey.trim().length > 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/config', async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await readDroidConfig();
    res.json({
      endpoint: config.endpoint,
      profile: config.profile,
      apiKeyConfigured: config.apiKey.trim().length > 0,
      updatedAt: config.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await readDroidConfig();
    const { config, errors } = buildConfigUpdate(existing, (req.body ?? {}) as DroidConfigPayload);
    if (errors.length > 0) {
      res.status(400).json({ error: errors.join('; ') });
      return;
    }

    await writeDroidConfigAtomic(config);
    res.json({
      success: true,
      config: {
        endpoint: config.endpoint,
        profile: config.profile,
        apiKeyConfigured: config.apiKey.trim().length > 0,
        updatedAt: config.updatedAt,
      },
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/doctor', async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await readDroidConfig();
    const health = await checkDroidHealth(config);
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
