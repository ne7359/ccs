import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getCcsDir } from '../../utils/config-manager';

const DEFAULT_DROID_ENDPOINT = 'http://127.0.0.1:4317';
const DEFAULT_DROID_PROFILE = 'droid';

export interface DroidConfig {
  endpoint: string;
  profile: string;
  apiKey: string;
  updatedAt: string;
}

export interface DroidHealthCheck {
  healthy: boolean;
  checks: {
    directoryExists: boolean;
    configExists: boolean;
    endpointConfigured: boolean;
    profileConfigured: boolean;
    endpointReachable: boolean;
    apiKeyValid: boolean | null;
    modelsAvailable: boolean | null;
  };
  details: {
    endpointMessage: string;
    apiKeyMessage: string;
    modelsMessage: string;
  };
}

interface ProbeResult {
  endpointReachable: boolean;
  endpointMessage: string;
  apiKeyValid: boolean | null;
  apiKeyMessage: string;
  modelsAvailable: boolean | null;
  modelsMessage: string;
}

function buildTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function getDroidDir(): string {
  return path.join(getCcsDir(), 'tools', 'droid');
}

export function getDroidConfigPath(): string {
  return path.join(getDroidDir(), 'config.json');
}

export function createDefaultDroidConfig(): DroidConfig {
  return {
    endpoint: DEFAULT_DROID_ENDPOINT,
    profile: DEFAULT_DROID_PROFILE,
    apiKey: '',
    updatedAt: new Date().toISOString(),
  };
}

export async function readDroidConfig(): Promise<DroidConfig> {
  const configPath = getDroidConfigPath();
  if (!(await pathExists(configPath))) {
    return createDefaultDroidConfig();
  }

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DroidConfig>;
    return {
      endpoint: parsed.endpoint || DEFAULT_DROID_ENDPOINT,
      profile: parsed.profile || DEFAULT_DROID_PROFILE,
      apiKey: parsed.apiKey || '',
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return createDefaultDroidConfig();
  }
}

export async function writeDroidConfigAtomic(config: DroidConfig): Promise<void> {
  const configPath = getDroidConfigPath();
  const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  try {
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    await fs.rename(tmpPath, configPath);
  } finally {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore cleanup errors when temp file was already moved/removed.
    }
  }
}

export function validateDroidEndpoint(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Endpoint must use http or https';
    }
    return null;
  } catch {
    return 'Endpoint is not a valid URL';
  }
}

async function probeEndpointAndModels(config: DroidConfig): Promise<ProbeResult> {
  const formatError = validateDroidEndpoint(config.endpoint);
  if (formatError) {
    return {
      endpointReachable: false,
      endpointMessage: formatError,
      apiKeyValid: config.apiKey ? false : null,
      apiKeyMessage: config.apiKey
        ? 'Cannot validate API key: endpoint URL invalid'
        : 'API key not configured',
      modelsAvailable: null,
      modelsMessage: 'Model check skipped: endpoint URL invalid',
    };
  }

  const endpoint = config.endpoint.replace(/\/+$/, '');

  try {
    const pingResponse = await fetch(endpoint, {
      method: 'GET',
      signal: buildTimeoutSignal(2500),
    });

    if (!pingResponse.ok && pingResponse.status >= 500) {
      return {
        endpointReachable: false,
        endpointMessage: `Endpoint unhealthy (HTTP ${pingResponse.status})`,
        apiKeyValid: config.apiKey ? false : null,
        apiKeyMessage: config.apiKey
          ? 'Cannot validate API key while endpoint is unhealthy'
          : 'API key not configured',
        modelsAvailable: null,
        modelsMessage: 'Model check skipped: endpoint is unhealthy',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      endpointReachable: false,
      endpointMessage: `Endpoint not reachable: ${message}`,
      apiKeyValid: config.apiKey ? false : null,
      apiKeyMessage: config.apiKey
        ? 'Cannot validate API key while endpoint is unreachable'
        : 'API key not configured',
      modelsAvailable: null,
      modelsMessage: 'Model check skipped: endpoint is unreachable',
    };
  }

  const modelsUrl = `${endpoint}/v1/models`;
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  try {
    const modelResponse = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: buildTimeoutSignal(3000),
    });

    const authFailed = modelResponse.status === 401 || modelResponse.status === 403;
    if (authFailed) {
      return {
        endpointReachable: true,
        endpointMessage: 'Endpoint reachable',
        apiKeyValid: false,
        apiKeyMessage: `API key rejected (HTTP ${modelResponse.status})`,
        modelsAvailable: false,
        modelsMessage: 'Model list unavailable due to auth failure',
      };
    }

    if (!modelResponse.ok) {
      return {
        endpointReachable: true,
        endpointMessage: 'Endpoint reachable',
        apiKeyValid: config.apiKey ? null : null,
        apiKeyMessage: config.apiKey
          ? `API key validation inconclusive (HTTP ${modelResponse.status})`
          : 'API key not configured',
        modelsAvailable: false,
        modelsMessage: `Model list request failed (HTTP ${modelResponse.status})`,
      };
    }

    const payload = (await modelResponse.json().catch(() => null)) as {
      data?: Array<{ id?: string }>;
    } | null;
    const models = payload?.data ?? [];
    const available = models.some((model) => typeof model.id === 'string' && model.id.length > 0);

    return {
      endpointReachable: true,
      endpointMessage: 'Endpoint reachable',
      apiKeyValid: config.apiKey ? true : null,
      apiKeyMessage: config.apiKey ? 'API key accepted' : 'API key not configured',
      modelsAvailable: available,
      modelsMessage: available ? `Models available (${models.length})` : 'No models returned',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      endpointReachable: true,
      endpointMessage: 'Endpoint reachable',
      apiKeyValid: config.apiKey ? null : null,
      apiKeyMessage: config.apiKey
        ? `API key validation inconclusive: ${message}`
        : 'API key not configured',
      modelsAvailable: false,
      modelsMessage: `Model check failed: ${message}`,
    };
  }
}

export async function checkDroidHealth(config: DroidConfig): Promise<DroidHealthCheck> {
  const droidDir = getDroidDir();
  const configPath = getDroidConfigPath();
  const directoryExists = await pathExists(droidDir);
  const configExists = await pathExists(configPath);
  const endpointConfigured = config.endpoint.trim().length > 0;
  const profileConfigured = config.profile.trim().length > 0;

  let probe: ProbeResult = {
    endpointReachable: false,
    endpointMessage: 'Endpoint check skipped',
    apiKeyValid: config.apiKey ? null : null,
    apiKeyMessage: config.apiKey ? 'API key validation skipped' : 'API key not configured',
    modelsAvailable: null,
    modelsMessage: 'Model check skipped',
  };

  if (endpointConfigured) {
    probe = await probeEndpointAndModels(config);
  } else {
    probe = {
      endpointReachable: false,
      endpointMessage: 'Endpoint is empty',
      apiKeyValid: config.apiKey ? false : null,
      apiKeyMessage: config.apiKey
        ? 'Cannot validate API key without endpoint'
        : 'API key not configured',
      modelsAvailable: null,
      modelsMessage: 'Model check skipped: endpoint missing',
    };
  }

  const apiKeyHealthy = probe.apiKeyValid !== false;
  const modelsHealthy = probe.modelsAvailable !== false;

  return {
    healthy:
      directoryExists &&
      configExists &&
      endpointConfigured &&
      profileConfigured &&
      probe.endpointReachable &&
      apiKeyHealthy &&
      modelsHealthy,
    checks: {
      directoryExists,
      configExists,
      endpointConfigured,
      profileConfigured,
      endpointReachable: probe.endpointReachable,
      apiKeyValid: probe.apiKeyValid,
      modelsAvailable: probe.modelsAvailable,
    },
    details: {
      endpointMessage: probe.endpointMessage,
      apiKeyMessage: probe.apiKeyMessage,
      modelsMessage: probe.modelsMessage,
    },
  };
}
