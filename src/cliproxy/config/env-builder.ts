/**
 * Environment variable builder for CLIProxy
 * Handles env var construction, merging, and remote URL rewriting
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CLIProxyProvider, ProviderModelMapping } from '../types';
import { getModelMappingFromConfig, getEnvVarsFromConfig } from '../base-config-loader';
import { getGlobalEnvConfig } from '../../config/unified-config-loader';
import { getEffectiveApiKey } from '../auth-token-manager';
import { expandPath } from '../../utils/helpers';
import { warn } from '../../utils/ui';
import type { CompositeTierConfig } from '../../config/unified-config-types';
import {
  validatePort,
  validateRemotePort,
  getRemoteDefaultPort,
  normalizeProtocol,
  CLIPROXY_DEFAULT_PORT,
} from './port-manager';
import { getProviderSettingsPath } from './path-resolver';
import {
  canonicalizeModelIdForProvider,
  MODEL_ENV_VAR_KEYS,
  migrateDeniedAntigravityModelAliases,
  normalizeModelEnvVarsForProvider,
  normalizeIFlowLegacyModelAliases,
  normalizeModelIdForProvider,
} from '../model-id-normalizer';

/** Settings file structure for user overrides */
interface ProviderSettings {
  env: NodeJS.ProcessEnv;
  presets?: Array<Record<string, unknown>>;
}

/** Model name prefix that was deprecated in CLIProxyAPI registry */
const DEPRECATED_MODEL_PREFIX = 'gemini-claude-';
/** Replacement prefix matching actual upstream model names */
const UPSTREAM_MODEL_PREFIX = 'claude-';
const CODEX_EFFORT_SUFFIX_REGEX = /-(xhigh|high|medium)$/i;
const PRESET_MODEL_KEYS = ['default', 'opus', 'sonnet', 'haiku'] as const;
const REQUIRED_PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;

function stripCodexEffortSuffix(modelId: string): string {
  return modelId.replace(CODEX_EFFORT_SUFFIX_REGEX, '');
}

/**
 * Migrate deprecated gemini-claude-* model names to upstream claude-* names in a settings file.
 * CLIProxyAPI registry no longer recognizes the gemini-claude-* prefix convention.
 * Preserves any suffixes like (high), [1m], etc.
 *
 * Returns true if migration was performed and file was updated.
 */
function migrateDeprecatedModelNames(
  settingsPath: string,
  provider: CLIProxyProvider,
  settings: ProviderSettings
): boolean {
  if (!settings.env || typeof settings.env !== 'object') return false;

  let migrated = false;
  for (const key of MODEL_ENV_VAR_KEYS) {
    const value = settings.env[key];
    if (typeof value !== 'string') continue;

    let canonical = value;
    // Check if the base model name (before any suffixes) uses the deprecated prefix.
    if (canonical.toLowerCase().startsWith(DEPRECATED_MODEL_PREFIX)) {
      canonical = UPSTREAM_MODEL_PREFIX + canonical.slice(DEPRECATED_MODEL_PREFIX.length);
    }
    canonical = normalizeModelIdForProvider(canonical, provider);
    if (provider === 'agy') {
      canonical = migrateDeniedAntigravityModelAliases(canonical);
    }

    if (canonical !== value) {
      settings.env[key] = canonical;
      migrated = true;
    }
  }

  if (provider === 'agy' && Array.isArray(settings.presets)) {
    for (const preset of settings.presets) {
      if (!preset || typeof preset !== 'object') continue;
      const presetRecord = preset as Record<string, unknown>;

      for (const key of PRESET_MODEL_KEYS) {
        const value = presetRecord[key];
        if (typeof value !== 'string') continue;
        let canonical = normalizeModelIdForProvider(value, provider);
        canonical = migrateDeniedAntigravityModelAliases(canonical);
        if (canonical !== value) {
          presetRecord[key] = canonical;
          migrated = true;
        }
      }
    }
  }

  if (migrated) {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    } catch {
      // Best-effort migration — don't block startup if write fails
    }
  }

  return migrated;
}

/**
 * Migrate codex effort-suffixed model IDs in settings to canonical IDs.
 * Example: gpt-5.3-codex-xhigh -> gpt-5.3-codex
 */
function migrateCodexEffortSuffixes(
  settingsPath: string,
  provider: CLIProxyProvider,
  settings: ProviderSettings
): boolean {
  if (provider !== 'codex') return false;
  if (!settings.env || typeof settings.env !== 'object') return false;

  let migrated = false;

  for (const key of MODEL_ENV_VAR_KEYS) {
    const value = settings.env[key];
    if (typeof value !== 'string') continue;
    const canonical = stripCodexEffortSuffix(value);
    if (canonical !== value) {
      settings.env[key] = canonical;
      migrated = true;
    }
  }

  if (Array.isArray(settings.presets)) {
    for (const preset of settings.presets) {
      if (!preset || typeof preset !== 'object') continue;
      const presetRecord = preset as Record<string, unknown>;

      for (const key of PRESET_MODEL_KEYS) {
        const value = presetRecord[key];
        if (typeof value !== 'string') continue;
        const canonical = stripCodexEffortSuffix(value);
        if (canonical !== value) {
          presetRecord[key] = canonical;
          migrated = true;
        }
      }
    }
  }

  if (migrated) {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    } catch {
      // Best-effort migration — don't block startup if write fails
    }
  }

  return migrated;
}

/**
 * Migrate legacy iFlow model IDs to current upstream model IDs.
 * Example: iflow-default -> qwen3-coder-plus, kimi-k2.5 -> kimi-k2
 */
function migrateIFlowPlaceholderModel(
  settingsPath: string,
  provider: CLIProxyProvider,
  settings: ProviderSettings
): boolean {
  if (provider !== 'iflow') return false;
  if (!settings.env || typeof settings.env !== 'object') return false;

  let migrated = false;
  const replaceLegacyIFlowModel = (value: string): string =>
    normalizeIFlowLegacyModelAliases(value);

  for (const key of MODEL_ENV_VAR_KEYS) {
    const value = settings.env[key];
    if (typeof value !== 'string') continue;
    const replaced = replaceLegacyIFlowModel(value);
    if (replaced !== value) {
      settings.env[key] = replaced;
      migrated = true;
    }
  }

  if (Array.isArray(settings.presets)) {
    for (const preset of settings.presets) {
      if (!preset || typeof preset !== 'object') continue;
      const presetRecord = preset as Record<string, unknown>;

      for (const key of PRESET_MODEL_KEYS) {
        const value = presetRecord[key];
        if (typeof value !== 'string') continue;
        const replaced = replaceLegacyIFlowModel(value);
        if (replaced !== value) {
          presetRecord[key] = replaced;
          migrated = true;
        }
      }
    }
  }

  if (migrated) {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    } catch {
      // Best-effort migration — don't block startup if write fails
    }
  }

  return migrated;
}

/** Remote proxy configuration for URL rewriting */
export interface RemoteProxyRewriteConfig {
  host: string;
  port?: number;
  protocol: 'http' | 'https';
  authToken?: string;
}

/**
 * Get model mapping for provider
 * Loads from config/base-{provider}.settings.json
 */
export function getModelMapping(provider: CLIProxyProvider): ProviderModelMapping {
  return getModelMappingFromConfig(provider);
}

/**
 * Get environment variables for Claude CLI (bundled defaults)
 * Uses provider-specific endpoint (e.g., /api/provider/gemini) for explicit routing.
 * This enables concurrent gemini/codex usage - each session routes to its provider via URL path.
 */
export function getClaudeEnvVars(
  provider: CLIProxyProvider,
  port: number = CLIPROXY_DEFAULT_PORT
): NodeJS.ProcessEnv {
  const models = getModelMapping(provider);

  // Base env vars from config file (includes ANTHROPIC_MAX_TOKENS, etc.)
  const baseEnvVars = getEnvVarsFromConfig(provider);

  // Core env vars that we always set dynamically
  const coreEnvVars = {
    // Provider-specific endpoint - routes to correct provider via URL path
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/api/provider/${provider}`,
    ANTHROPIC_AUTH_TOKEN: getEffectiveApiKey(),
    ANTHROPIC_MODEL: models.claudeModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: models.opusModel || models.claudeModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnetModel || models.claudeModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haikuModel || models.claudeModel,
  };

  // Filter out core env vars from base config to avoid conflicts
  const {
    ANTHROPIC_BASE_URL: _baseUrl,
    ANTHROPIC_AUTH_TOKEN: _authToken,
    ANTHROPIC_MODEL: _model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: _opusModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: _sonnetModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: _haikuModel,
    ...additionalEnvVars
  } = baseEnvVars;

  // Merge core env vars with additional env vars from base config
  const mergedEnv = {
    ...coreEnvVars,
    ...additionalEnvVars, // Includes ANTHROPIC_MAX_TOKENS, etc.
  };

  return normalizeModelEnvVarsForProvider(mergedEnv, provider);
}

/**
 * Get global env vars to inject into all third-party profiles.
 * Returns empty object if disabled.
 */
function getGlobalEnvVars(): Record<string, string> {
  const globalEnvConfig = getGlobalEnvConfig();
  if (!globalEnvConfig.enabled) {
    return {};
  }
  return globalEnvConfig.env;
}

/**
 * Ensure required CLIProxy env vars are present.
 * Falls back to bundled defaults if missing from user settings.
 * This prevents 404 errors when users forget to set BASE_URL/AUTH_TOKEN.
 */
function ensureRequiredEnvVars(
  envVars: NodeJS.ProcessEnv,
  provider: CLIProxyProvider,
  port: number
): NodeJS.ProcessEnv {
  const validPort = validatePort(port);
  const result = { ...envVars };
  const defaults = getClaudeEnvVars(provider, validPort);

  // Fill in missing required vars from defaults
  if (!result.ANTHROPIC_BASE_URL?.trim()) {
    result.ANTHROPIC_BASE_URL = defaults.ANTHROPIC_BASE_URL;
  }
  if (!result.ANTHROPIC_AUTH_TOKEN?.trim()) {
    result.ANTHROPIC_AUTH_TOKEN = defaults.ANTHROPIC_AUTH_TOKEN;
  }

  // Normalize local CLIProxy root/wrong-provider URLs to provider-pinned endpoint.
  // This prevents model-routed "unknown provider" failures for codex effort aliases.
  if (result.ANTHROPIC_BASE_URL?.trim()) {
    result.ANTHROPIC_BASE_URL = normalizeLocalProviderBaseUrl(
      result.ANTHROPIC_BASE_URL,
      provider,
      validPort
    );
  }

  return normalizeModelEnvVarsForProvider(result, provider);
}

/** Localhost hostnames used for local CLIProxy endpoints */
const LOCALHOST_NAMES = new Set(['127.0.0.1', 'localhost', '0.0.0.0']);

/**
 * Normalize local CLIProxy endpoint to the expected provider route.
 * Only rewrites localhost URLs that target the active local port.
 */
function normalizeLocalProviderBaseUrl(
  baseUrl: string,
  provider: CLIProxyProvider,
  port: number
): string {
  try {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return baseUrl;
    if (!LOCALHOST_NAMES.has(parsed.hostname.toLowerCase())) return baseUrl;

    const effectivePort = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : parsed.protocol === 'https:'
        ? 443
        : 80;
    if (!Number.isFinite(effectivePort) || effectivePort !== port) return baseUrl;

    const expectedPath = `/api/provider/${provider}`;
    if (parsed.pathname === expectedPath && !parsed.search && !parsed.hash) return baseUrl;

    parsed.pathname = expectedPath;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Rewrite localhost URLs to remote server URLs.
 * Handles various localhost patterns: 127.0.0.1, localhost, 0.0.0.0
 */
function rewriteLocalhostUrls(
  envVars: NodeJS.ProcessEnv,
  provider: CLIProxyProvider,
  remoteConfig: RemoteProxyRewriteConfig
): NodeJS.ProcessEnv {
  const result = { ...envVars };
  const baseUrl = result.ANTHROPIC_BASE_URL;

  if (!baseUrl) return result;

  // Check if URL points to localhost (127.0.0.1, localhost, 0.0.0.0)
  const localhostPattern = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?/i;
  if (!localhostPattern.test(baseUrl)) return result;

  // Build remote URL with smart port handling (8317 for HTTP, 443 for HTTPS)
  // Validate port and normalize protocol for defensive handling
  const normalizedProtocol = normalizeProtocol(remoteConfig.protocol);
  const validatedPort = validateRemotePort(remoteConfig.port);
  const effectivePort = validatedPort ?? getRemoteDefaultPort(normalizedProtocol);
  // Omit port suffix for standard web ports (80/443) for cleaner URLs
  const standardWebPort = normalizedProtocol === 'https' ? 443 : 80;
  const portSuffix = effectivePort === standardWebPort ? '' : `:${effectivePort}`;
  const remoteBaseUrl = `${normalizedProtocol}://${remoteConfig.host}${portSuffix}/api/provider/${provider}`;

  result.ANTHROPIC_BASE_URL = remoteBaseUrl;

  // Update auth token if provided
  if (remoteConfig.authToken) {
    result.ANTHROPIC_AUTH_TOKEN = remoteConfig.authToken;
  }

  return result;
}

/**
 * Get effective environment variables for provider
 *
 * Priority order:
 * 1. Custom settings path (for user-defined CLIProxy variants)
 * 2. User settings file (~/.ccs/{provider}.settings.json) if exists
 * 3. Bundled defaults from PROVIDER_CONFIGS
 *
 * All results are merged with global_env vars (telemetry/reporting disables).
 * User takes full responsibility for custom settings.
 *
 * If remoteRewriteConfig is provided, localhost URLs are rewritten to remote server.
 */
export function getEffectiveEnvVars(
  provider: CLIProxyProvider,
  port: number = CLIPROXY_DEFAULT_PORT,
  customSettingsPath?: string,
  remoteRewriteConfig?: RemoteProxyRewriteConfig
): NodeJS.ProcessEnv {
  // Get global env vars (DISABLE_TELEMETRY, etc.)
  const globalEnv = getGlobalEnvVars();

  let envVars: NodeJS.ProcessEnv;

  // Priority 1: Custom settings path (for user-defined variants)
  if (customSettingsPath) {
    const expandedPath = expandPath(customSettingsPath);
    if (fs.existsSync(expandedPath)) {
      try {
        const content = fs.readFileSync(expandedPath, 'utf-8');
        const settings: ProviderSettings = JSON.parse(content);

        if (settings.env && typeof settings.env === 'object') {
          // Migrate deprecated gemini-claude-* model names if present
          migrateDeprecatedModelNames(expandedPath, provider, settings);
          // Migrate codex effort suffixes to canonical IDs if present
          migrateCodexEffortSuffixes(expandedPath, provider, settings);
          // Migrate legacy iFlow placeholders to supported model IDs
          migrateIFlowPlaceholderModel(expandedPath, provider, settings);
          // Custom variant settings found - merge with global env
          envVars = { ...globalEnv, ...settings.env };
          // Ensure required vars are present (fall back to defaults if missing)
          envVars = ensureRequiredEnvVars(envVars, provider, port);
          // Apply remote rewrite if configured
          if (remoteRewriteConfig) {
            envVars = rewriteLocalhostUrls(envVars, provider, remoteRewriteConfig);
          }
          return envVars;
        }
      } catch {
        // Invalid JSON - fall through to provider defaults
        console.warn(warn(`Invalid settings file: ${customSettingsPath}`));
      }
    } else {
      console.warn(warn(`Settings file not found: ${customSettingsPath}`));
    }
  }

  // Priority 2: Default provider settings file
  const settingsPath = getProviderSettingsPath(provider);

  // Check for user override file
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings: ProviderSettings = JSON.parse(content);

      if (settings.env && typeof settings.env === 'object') {
        // Migrate deprecated gemini-claude-* model names if present
        migrateDeprecatedModelNames(settingsPath, provider, settings);
        // Migrate codex effort suffixes to canonical IDs if present
        migrateCodexEffortSuffixes(settingsPath, provider, settings);
        // Migrate legacy iFlow placeholders to supported model IDs
        migrateIFlowPlaceholderModel(settingsPath, provider, settings);
        // User override found - merge with global env
        envVars = { ...globalEnv, ...settings.env };
        // Ensure required vars are present (fall back to defaults if missing)
        envVars = ensureRequiredEnvVars(envVars, provider, port);
        // Apply remote rewrite if configured
        if (remoteRewriteConfig) {
          envVars = rewriteLocalhostUrls(envVars, provider, remoteRewriteConfig);
        }
        return envVars;
      }
    } catch {
      // Invalid JSON or structure - fall through to defaults
      // Silent fallback: don't spam errors for broken user files
    }
  }

  // No override or invalid - use bundled defaults merged with global env
  return { ...globalEnv, ...getClaudeEnvVars(provider, port) };
}

/**
 * Copy bundled settings template to user directory if not exists
 * Called during installation/first run
 */
export function ensureProviderSettings(provider: CLIProxyProvider): void {
  const settingsPath = getProviderSettingsPath(provider);
  const defaultEnv = getClaudeEnvVars(provider);

  const writeSettings = (settings: Record<string, unknown>): void => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', {
      mode: 0o600,
    });
  };

  // Create initial file when missing.
  if (!fs.existsSync(settingsPath)) {
    writeSettings({ env: defaultEnv });
    return;
  }

  // Existing file: repair missing/invalid core env keys without dropping user data.
  let rawContent = '';
  try {
    rawContent = fs.readFileSync(settingsPath, 'utf-8');
  } catch {
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(rawContent) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('settings root must be an object');
    }
    parsed = value as Record<string, unknown>;
  } catch {
    // Preserve corrupt payload for manual inspection, then recover with defaults.
    const backupPath = `${settingsPath}.corrupt-${Date.now()}`;
    try {
      fs.writeFileSync(backupPath, rawContent || '', { mode: 0o600 });
    } catch {
      // Best effort only.
    }
    writeSettings({ env: defaultEnv });
    return;
  }

  const envCandidate = parsed.env;
  const mergedEnv: Record<string, string> =
    envCandidate && typeof envCandidate === 'object' && !Array.isArray(envCandidate)
      ? { ...(envCandidate as Record<string, string>) }
      : {};

  let mutated = !(envCandidate && typeof envCandidate === 'object' && !Array.isArray(envCandidate));
  for (const key of REQUIRED_PROVIDER_ENV_KEYS) {
    const current = mergedEnv[key];
    if (typeof current !== 'string' || current.trim().length === 0) {
      mergedEnv[key] = defaultEnv[key] || '';
      mutated = true;
    }
  }

  // Canonicalize provider-specific model aliases (e.g., AGY Sonnet 4.6 thinking legacy IDs).
  for (const key of MODEL_ENV_VAR_KEYS) {
    const current = mergedEnv[key];
    if (typeof current !== 'string' || current.trim().length === 0) continue;
    let canonical = canonicalizeModelIdForProvider(current, provider);
    if (provider === 'agy') {
      canonical = migrateDeniedAntigravityModelAliases(canonical);
    }
    if (canonical !== current) {
      mergedEnv[key] = canonical;
      mutated = true;
    }
  }

  const presetsCandidate = parsed.presets;
  if (Array.isArray(presetsCandidate)) {
    for (const preset of presetsCandidate) {
      if (!preset || typeof preset !== 'object') continue;
      const presetRecord = preset as Record<string, unknown>;
      for (const key of PRESET_MODEL_KEYS) {
        const value = presetRecord[key];
        if (typeof value !== 'string') continue;
        let canonical = canonicalizeModelIdForProvider(value, provider);
        if (provider === 'agy') {
          canonical = migrateDeniedAntigravityModelAliases(canonical);
        }
        if (canonical !== value) {
          presetRecord[key] = canonical;
          mutated = true;
        }
      }
    }
  }

  if (!mutated) {
    return;
  }

  const repairedSettings: Record<string, unknown> = {
    ...parsed,
    env: mergedEnv,
  };
  writeSettings(repairedSettings);
}

/**
 * Get environment variables for remote proxy mode.
 * Uses the remote proxy's provider endpoint as the base URL.
 * Respects user model settings from custom settings path or provider settings file.
 *
 * @param provider CLIProxy provider (gemini, codex, agy, qwen, iflow)
 * @param remoteConfig Remote proxy connection details
 * @param customSettingsPath Optional path to user's custom settings file
 * @returns Environment variables for Claude CLI
 */
export function getRemoteEnvVars(
  provider: CLIProxyProvider,
  remoteConfig: { host: string; port?: number; protocol: 'http' | 'https'; authToken?: string },
  customSettingsPath?: string
): Record<string, string> {
  // Build URL with smart port handling (8317 for HTTP, 443 for HTTPS)
  // Validate port and normalize protocol for defensive handling
  const normalizedProtocol = normalizeProtocol(remoteConfig.protocol);
  const validatedPort = validateRemotePort(remoteConfig.port);
  const effectivePort = validatedPort ?? getRemoteDefaultPort(normalizedProtocol);
  // Omit port suffix for standard web ports (80/443) for cleaner URLs
  const standardWebPort = normalizedProtocol === 'https' ? 443 : 80;
  const portSuffix = effectivePort === standardWebPort ? '' : `:${effectivePort}`;
  // Remote CLIProxyAPI uses root path (e.g., /v1/messages), not /api/provider/{provider}/v1/messages
  // The /api/provider/ prefix is only for local CLIProxy instances
  const baseUrl = `${normalizedProtocol}://${remoteConfig.host}${portSuffix}`;

  // Get global env vars (DISABLE_TELEMETRY, etc.)
  const globalEnv = getGlobalEnvVars();

  // Load user settings with priority: custom path > user settings file > base config
  let userEnvVars: Record<string, string> = {};

  // Priority 1: Custom settings path (for user-defined variants)
  if (customSettingsPath) {
    const expandedPath = expandPath(customSettingsPath);
    if (fs.existsSync(expandedPath)) {
      try {
        const content = fs.readFileSync(expandedPath, 'utf-8');
        const settings: ProviderSettings = JSON.parse(content);
        if (settings.env && typeof settings.env === 'object') {
          migrateDeprecatedModelNames(expandedPath, provider, settings);
          migrateCodexEffortSuffixes(expandedPath, provider, settings);
          migrateIFlowPlaceholderModel(expandedPath, provider, settings);
          userEnvVars = settings.env as Record<string, string>;
        }
      } catch {
        // Invalid JSON - fall through to provider defaults
        console.warn(warn(`Invalid settings file: ${customSettingsPath}`));
      }
    }
  }

  // Priority 2: Default provider settings file (~/.ccs/{provider}.settings.json)
  if (Object.keys(userEnvVars).length === 0) {
    const settingsPath = getProviderSettingsPath(provider);
    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        const settings: ProviderSettings = JSON.parse(content);
        if (settings.env && typeof settings.env === 'object') {
          migrateDeprecatedModelNames(settingsPath, provider, settings);
          migrateCodexEffortSuffixes(settingsPath, provider, settings);
          migrateIFlowPlaceholderModel(settingsPath, provider, settings);
          userEnvVars = settings.env as Record<string, string>;
        }
      } catch {
        // Invalid JSON - fall through to base config
      }
    }
  }

  // Priority 3: Base config defaults
  if (Object.keys(userEnvVars).length === 0) {
    const models = getModelMapping(provider);
    const baseEnvVars = getEnvVarsFromConfig(provider);
    // Filter out URL/auth from base config (we'll set those from remote config)
    const {
      ANTHROPIC_BASE_URL: _baseUrl,
      ANTHROPIC_AUTH_TOKEN: _authToken,
      ...additionalEnvVars
    } = baseEnvVars;
    userEnvVars = {
      ...additionalEnvVars,
      ANTHROPIC_MODEL: models.claudeModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: models.opusModel || models.claudeModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnetModel || models.claudeModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haikuModel || models.claudeModel,
    };
  }

  // Build final env: global + user settings + remote URL/auth override
  const env: Record<string, string> = {
    ...globalEnv,
    ...userEnvVars,
    // Always override URL and auth token with remote config
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: remoteConfig.authToken || getEffectiveApiKey(),
  };

  return normalizeModelEnvVarsForProvider(env, provider) as Record<string, string>;
}

/** Remote config for composite variant (passed from env-resolver) */
export interface CompositeRemoteConfig {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  authToken?: string;
}

/**
 * Get environment variables for composite variant.
 * Uses root URL (no /api/provider/ path) for model-based routing.
 * Each tier maps to a different provider's model, routed by CLIProxyAPI.
 *
 * @param tiers Per-tier provider+model mappings
 * @param defaultTier Which tier ANTHROPIC_MODEL equals
 * @param port Local CLIProxy port (ignored if remoteConfig provided)
 * @param customSettingsPath Optional path to user's custom settings file
 * @param remoteConfig Optional remote proxy config (overrides localhost URL/auth)
 */
export function getCompositeEnvVars(
  tiers: { opus: CompositeTierConfig; sonnet: CompositeTierConfig; haiku: CompositeTierConfig },
  defaultTier: 'opus' | 'sonnet' | 'haiku',
  port: number = CLIPROXY_DEFAULT_PORT,
  customSettingsPath?: string,
  remoteConfig?: CompositeRemoteConfig
): Record<string, string> {
  const globalEnv = getGlobalEnvVars();

  // Load user settings if provided (may contain additional env vars like hooks)
  let additionalEnvVars: Record<string, string> = {};
  if (customSettingsPath) {
    const expandedPath = expandPath(customSettingsPath);
    if (fs.existsSync(expandedPath)) {
      try {
        const content = fs.readFileSync(expandedPath, 'utf-8');
        const settings: ProviderSettings = JSON.parse(content);
        if (settings.env && typeof settings.env === 'object') {
          // Extract non-core env vars (hooks, etc.)
          const {
            ANTHROPIC_BASE_URL: _baseUrl,
            ANTHROPIC_AUTH_TOKEN: _authToken,
            ANTHROPIC_MODEL: _model,
            ANTHROPIC_DEFAULT_OPUS_MODEL: _opus,
            ANTHROPIC_DEFAULT_SONNET_MODEL: _sonnet,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: _haiku,
            ...extra
          } = settings.env as Record<string, string>;
          additionalEnvVars = extra;
        }
      } catch {
        // Invalid JSON — ignore
      }
    }
  }

  const validPort = validatePort(port);

  // Defensive: handle missing tiers gracefully
  const opusModel = tiers.opus?.model
    ? normalizeModelIdForProvider(tiers.opus.model, tiers.opus.provider)
    : undefined;
  const sonnetModel = tiers.sonnet?.model
    ? normalizeModelIdForProvider(tiers.sonnet.model, tiers.sonnet.provider)
    : undefined;
  const haikuModel = tiers.haiku?.model
    ? normalizeModelIdForProvider(tiers.haiku.model, tiers.haiku.provider)
    : undefined;
  const defaultTierModel = tiers[defaultTier];
  const defaultModel = defaultTierModel?.model
    ? normalizeModelIdForProvider(defaultTierModel.model, defaultTierModel.provider)
    : undefined;

  // If default tier is missing, we cannot proceed meaningfully
  if (!defaultModel) {
    throw new Error(`Missing model for default tier '${defaultTier}'`);
  }

  // Determine base URL and auth token based on remote vs local mode
  const baseUrl = remoteConfig
    ? (() => {
        const normalizedProtocol = normalizeProtocol(remoteConfig.protocol);
        const effectivePort =
          validateRemotePort(remoteConfig.port) ?? getRemoteDefaultPort(normalizedProtocol);
        const standardWebPort = normalizedProtocol === 'https' ? 443 : 80;
        const portSuffix = effectivePort === standardWebPort ? '' : `:${effectivePort}`;
        return `${normalizedProtocol}://${remoteConfig.host}${portSuffix}`;
      })()
    : `http://127.0.0.1:${validPort}`;

  const authToken = remoteConfig?.authToken ?? getEffectiveApiKey();

  const env: Record<string, string> = {
    ...globalEnv,
    ...additionalEnvVars,
    // Root URL — CLIProxyAPI routes based on model name in request body
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: authToken,
    ANTHROPIC_MODEL: defaultModel,
  };

  // Only set tier env vars if the tier exists
  if (opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel;
  if (sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel;
  if (haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel;

  return env;
}
