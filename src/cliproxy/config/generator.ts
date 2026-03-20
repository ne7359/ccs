/**
 * Core config generation for CLIProxyAPI
 * Handles unified config.yaml generation for all providers
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CLIProxyProvider, ProviderConfig } from '../types';
import { getProviderDisplayName } from '../provider-capabilities';
import { getModelMappingFromConfig } from '../base-config-loader';
import { loadOrCreateUnifiedConfig } from '../../config/unified-config-loader';
import { getEffectiveApiKey, getEffectiveManagementSecret } from '../auth-token-manager';
import { getDeniedModelIdReasonForProvider } from '../model-id-normalizer';
import { getAuthDir, getProviderAuthDir, getConfigPathForPort } from './path-resolver';
import { CLIPROXY_DEFAULT_PORT } from './port-manager';

/** Internal API key for CCS-managed requests */
export const CCS_INTERNAL_API_KEY = 'ccs-internal-managed';

/** Simple secret key for Control Panel login (user-facing) */
export const CCS_CONTROL_PANEL_SECRET = 'ccs';

/**
 * Config version - bump when config format changes to trigger regeneration
 * v1: Initial config (port, auth-dir, api-keys only)
 * v2: Full-featured config with dashboard, quota mgmt, simplified key
 * v3: Logging disabled by default (user opt-in via ~/.ccs/config.yaml)
 * v4: Added Kiro (AWS) and GitHub Copilot providers
 * v5: Added disable-cooling: true for stability
 * v6: Added oauth-model-alias with Opus 4.6 support
 * v7: Added fork:true for Claude model aliases (keep both upstream and alias names)
 * v8: Added Gemini 3.1 preview aliases for provider routing compatibility
 * v9: Added resilient alias compatibility expansion and cache-assisted alias enrichment
 * v10: Migrated deprecated gemini-claude-* aliases to upstream claude-* aliases
 * v11: Migrated deprecated claude-sonnet-4-6-thinking aliases to claude-sonnet-4-6
 * v12: Removed denylisted Antigravity Claude 4.5 aliases
 * v13: Removed aggressive Gemini alias expansion to reduce model list noise in Control Panel
 */
export const CLIPROXY_CONFIG_VERSION = 13;

interface OAuthModelAliasEntry {
  name: string;
  alias: string;
  fork?: boolean;
}

const DEPRECATED_ANTIGRAVITY_ALIAS_PREFIX = 'gemini-claude-';
const UPSTREAM_CLAUDE_ALIAS_PREFIX = 'claude-';
const DEPRECATED_ANTIGRAVITY_SONNET_46_THINKING_REGEX = /^claude-sonnet-4(?:[.-])6-thinking$/i;
const CANONICAL_ANTIGRAVITY_SONNET_46_ALIAS = 'claude-sonnet-4-6';

/**
 * Default Antigravity oauth-model-alias entries.
 * Maps user-facing model names to Antigravity internal model names.
 * Additional compatibility aliases are derived automatically at generation time.
 */
const DEFAULT_ANTIGRAVITY_ALIASES: OAuthModelAliasEntry[] = [
  { name: 'rev19-uic3-1p', alias: 'gemini-2.5-computer-use-preview-10-2025' },
  { name: 'gemini-3-pro-image', alias: 'gemini-3-pro-image-preview' },
  { name: 'gemini-3-pro-high', alias: 'gemini-3-pro-preview' },
  { name: 'gemini-3-pro-high', alias: 'gemini-3.1-pro-preview' },
  { name: 'gemini-3-pro-high', alias: 'gemini-3.1-pro-preview-customtools' },
  { name: 'gemini-3-flash', alias: 'gemini-3-flash-preview' },
  { name: 'claude-sonnet-4-6', alias: 'claude-sonnet-4-6', fork: true },
  // Backward compatibility: legacy sonnet thinking alias now routes to canonical model ID.
  { name: 'claude-sonnet-4-6-thinking', alias: 'claude-sonnet-4-6', fork: true },
  { name: 'claude-opus-4-6-thinking', alias: 'claude-opus-4-6-thinking', fork: true },
];

/**
 * Get provider configuration
 * Model mappings are loaded from config/base-{provider}.settings.json
 */
export function getProviderConfig(provider: CLIProxyProvider): ProviderConfig {
  // Load models from base config file
  const models = getModelMappingFromConfig(provider);

  return {
    name: provider,
    displayName: getProviderDisplayName(provider),
    models,
    requiresOAuth: true, // All CLIProxy providers require OAuth
  };
}

/**
 * Get CLIProxy logging settings from user config.
 * Defaults to disabled to prevent disk bloat.
 */
function getLoggingSettings(): { loggingToFile: boolean; requestLog: boolean } {
  const config = loadOrCreateUnifiedConfig();
  return {
    loggingToFile: config.cliproxy.logging?.enabled ?? false,
    requestLog: config.cliproxy.logging?.request_log ?? false,
  };
}

function sanitizeYamlScalar(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeAntigravityAlias(rawAlias: string): string {
  const normalized = sanitizeYamlScalar(rawAlias);
  if (normalized.toLowerCase().startsWith(DEPRECATED_ANTIGRAVITY_ALIAS_PREFIX)) {
    const migratedPrefix =
      UPSTREAM_CLAUDE_ALIAS_PREFIX + normalized.slice(DEPRECATED_ANTIGRAVITY_ALIAS_PREFIX.length);
    return normalizeAntigravityAlias(migratedPrefix);
  }

  if (DEPRECATED_ANTIGRAVITY_SONNET_46_THINKING_REGEX.test(normalized)) {
    return CANONICAL_ANTIGRAVITY_SONNET_46_ALIAS;
  }

  return normalized;
}

function addAliasEntry(
  entries: OAuthModelAliasEntry[],
  indexByKey: Map<string, number>,
  entry: OAuthModelAliasEntry
): void {
  const normalized: OAuthModelAliasEntry = {
    name: sanitizeYamlScalar(entry.name),
    alias: normalizeAntigravityAlias(entry.alias),
    fork: entry.fork || undefined,
  };
  if (!normalized.name || !normalized.alias) return;
  if (getDeniedModelIdReasonForProvider(normalized.name, 'agy')) return;
  if (getDeniedModelIdReasonForProvider(normalized.alias, 'agy')) return;

  const key = `${normalized.name}\u0000${normalized.alias}`;
  const existingIndex = indexByKey.get(key);
  if (existingIndex !== undefined) {
    if (normalized.fork) entries[existingIndex].fork = true;
    return;
  }

  indexByKey.set(key, entries.length);
  entries.push(normalized);
}

function parseExistingAntigravityAliases(existingAliases: string): OAuthModelAliasEntry[] {
  const entries: OAuthModelAliasEntry[] = [];
  const lines = existingAliases.replace(/\r\n/g, '\n').split('\n');

  let currentChannel = '';
  let currentName = '';
  let currentAlias = '';
  let currentFork = false;

  const flushCurrent = () => {
    if (currentName && currentAlias && (!currentChannel || currentChannel === 'antigravity')) {
      entries.push({
        name: sanitizeYamlScalar(currentName),
        alias: sanitizeYamlScalar(currentAlias),
        fork: currentFork || undefined,
      });
    }
    currentName = '';
    currentAlias = '';
    currentFork = false;
  };

  for (const line of lines) {
    const channelMatch = line.match(/^\s{2}([a-zA-Z0-9_-]+):\s*$/);
    if (channelMatch) {
      flushCurrent();
      currentChannel = channelMatch[1].trim().toLowerCase();
      continue;
    }

    if (currentChannel && currentChannel !== 'antigravity') continue;

    const nameMatch = line.match(/^\s+-\s*name:\s*(.+)/);
    const aliasMatch = line.match(/^\s+alias:\s*(.+)/);
    const forkMatch = line.match(/^\s+fork:\s*(.+)/);

    if (nameMatch) {
      flushCurrent();
      currentName = nameMatch[1];
      continue;
    }

    if (aliasMatch) {
      currentAlias = aliasMatch[1];
      continue;
    }

    if (forkMatch) {
      currentFork = sanitizeYamlScalar(forkMatch[1]).toLowerCase() === 'true';
    }
  }

  flushCurrent();
  return entries;
}

function toDottedGeminiVersionAlias(alias: string): string | null {
  const match = alias.match(/^(gemini-\d+)-(\d+)(-.+)$/);
  if (!match) return null;
  return `${match[1]}.${match[2]}${match[3]}`;
}

function toHyphenatedGeminiVersionAlias(alias: string): string | null {
  const match = alias.match(/^(gemini-\d+)\.(\d+)(-.+)$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}${match[3]}`;
}

function buildGeminiCompatibilityAliases(alias: string): string[] {
  if (!alias.startsWith('gemini-') || !alias.includes('-preview')) return [];

  const variants = new Set<string>();
  const queue: string[] = [alias];

  const enqueue = (candidate: string) => {
    if (!candidate || candidate === alias || variants.has(candidate)) return;
    variants.add(candidate);
    queue.push(candidate);
  };

  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    if (current.startsWith('gemini-') && current.includes('-preview')) {
      if (current.endsWith('-customtools')) {
        enqueue(current.slice(0, -'-customtools'.length));
      } else {
        enqueue(`${current}-customtools`);
      }
    }

    const dotted = toDottedGeminiVersionAlias(current);
    if (dotted) enqueue(dotted);

    const hyphenated = toHyphenatedGeminiVersionAlias(current);
    if (hyphenated) enqueue(hyphenated);
  }

  return [...variants];
}

function getCompatibilityAliases(entries: OAuthModelAliasEntry[]): OAuthModelAliasEntry[] {
  const compatibilityAliases: OAuthModelAliasEntry[] = [];
  for (const entry of entries) {
    const variants = buildGeminiCompatibilityAliases(entry.alias);
    for (const variant of variants) {
      compatibilityAliases.push({
        name: entry.name,
        alias: variant,
        fork: entry.fork,
      });
    }
  }
  return compatibilityAliases;
}

/**
 * Generate oauth-model-alias YAML section.
 * Merges default Antigravity aliases with any user-added custom aliases.
 */
function generateOAuthModelAliasSection(existingAliases?: string): string {
  const aliasEntries: OAuthModelAliasEntry[] = [];
  const aliasIndexByKey = new Map<string, number>();

  // Start with default aliases.
  for (const alias of DEFAULT_ANTIGRAVITY_ALIASES) {
    addAliasEntry(aliasEntries, aliasIndexByKey, alias);
  }

  // Merge existing user aliases (dedupe by name+alias, not by name only).
  if (existingAliases) {
    const parsed = parseExistingAntigravityAliases(existingAliases);
    for (const alias of parsed) {
      addAliasEntry(aliasEntries, aliasIndexByKey, alias);
    }
  }

  // Expand lightweight compatibility aliases (dot/hyphen + customtools toggle).
  for (const alias of getCompatibilityAliases(aliasEntries)) {
    addAliasEntry(aliasEntries, aliasIndexByKey, alias);
  }

  const entries = aliasEntries
    .map((a) => {
      let entry = `    - name: ${a.name}\n      alias: ${a.alias}`;
      if (a.fork) entry += '\n      fork: true';
      return entry;
    })
    .join('\n');

  return `oauth-model-alias:\n  antigravity:\n${entries}`;
}

/**
 * Generate UNIFIED config.yaml content for ALL providers
 * This enables concurrent usage of gemini/codex/agy without config conflicts.
 * CLIProxyAPI routes requests by model name to the appropriate provider.
 *
 * @param port - Server port (default: 8317)
 * @param userApiKeys - User-added API keys to preserve (default: [])
 * @param existingAliases - Existing oauth-model-alias content to merge with defaults
 */
function generateUnifiedConfigContent(
  port: number = CLIPROXY_DEFAULT_PORT,
  userApiKeys: string[] = [],
  existingAliases?: string
): string {
  const authDir = getAuthDir(); // Base auth dir - CLIProxyAPI scans subdirectories
  // Convert Windows backslashes to forward slashes for YAML compatibility
  const authDirNormalized = authDir.split(path.sep).join('/');

  // Get logging settings from user config (disabled by default)
  const { loggingToFile, requestLog } = getLoggingSettings();

  // Get effective auth tokens (respects user customization)
  const effectiveApiKey = getEffectiveApiKey();
  const effectiveSecret = getEffectiveManagementSecret();

  // Build api-keys section with internal key + preserved user keys
  const allApiKeys = [effectiveApiKey, ...userApiKeys];
  const apiKeysYaml = allApiKeys.map((key) => `  - "${key}"`).join('\n');

  // Unified config with enhanced CLIProxyAPI features
  const config = `# CLIProxyAPI config generated by CCS v${CLIPROXY_CONFIG_VERSION}
# Supports: gemini, codex, agy, qwen, iflow (concurrent usage)
# Generated: ${new Date().toISOString()}
#
# This config is auto-managed by CCS. Manual edits may be overwritten.
# Use 'ccs doctor' to regenerate with latest settings.

# =============================================================================
# Server Settings
# =============================================================================

port: ${port}
debug: false

# =============================================================================
# Logging
# =============================================================================
# WARNING: Logs can grow to several GB if enabled!
# To enable logging, edit ~/.ccs/config.yaml:
#   cliproxy:
#     logging:
#       enabled: true
#       request_log: true
# Then run 'ccs doctor --fix' to regenerate this config.
# Use 'ccs cleanup' to remove old logs.

# Write logs to file (stored in ~/.ccs/cliproxy/logs/)
logging-to-file: ${loggingToFile}

# Log individual API requests for debugging/analytics
request-log: ${requestLog}

# =============================================================================
# Dashboard & Management
# =============================================================================

# Enable usage statistics for CCS dashboard analytics
usage-statistics-enabled: true

# Remote management API for CCS dashboard integration
remote-management:
  allow-remote: true
  secret-key: "${effectiveSecret}"
  disable-control-panel: false

# =============================================================================
# Reliability & Quota Management
# =============================================================================

# Disable quota cooldown scheduling for stability
disable-cooling: true

# Auto-retry on transient errors (403, 408, 500, 502, 503, 504)
request-retry: 0
max-retry-interval: 0

# Auto-switch accounts on quota exceeded (429)
# This enables seamless multi-account rotation when rate limited
quota-exceeded:
  switch-project: true
  switch-preview-model: true

# =============================================================================
# Authentication
# =============================================================================

# API keys for CCS and user-added external requests
# NOTE: User-added keys are preserved across CCS updates (fix for issue #200)
api-keys:
${apiKeysYaml}

# OAuth tokens directory (auto-discovered by CLIProxyAPI)
auth-dir: "${authDirNormalized}"
${generateOAuthModelAliasSection(existingAliases)}
`;

  return config;
}

/**
 * Generate unified config.yaml file (supports all providers concurrently)
 * Only regenerates if config doesn't exist.
 * @returns Path to config file
 */
export function generateConfig(
  provider: CLIProxyProvider,
  port: number = CLIPROXY_DEFAULT_PORT
): string {
  const configPath = getConfigPathForPort(port);

  // Ensure provider auth directory exists
  const authDir = getProviderAuthDir(provider);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });

  // Only generate config if it doesn't exist (unified config serves all providers)
  if (!fs.existsSync(configPath)) {
    const configContent = generateUnifiedConfigContent(port);
    fs.writeFileSync(configPath, configContent, { mode: 0o600 });
  }

  return configPath;
}

/**
 * Parse user-added API keys from existing config content.
 * Extracts all keys except the internal CCS key for preservation.
 *
 * @param content - Existing config.yaml content
 * @returns Array of user-added API keys (excludes CCS_INTERNAL_API_KEY)
 */
export function parseUserApiKeys(content: string): string[] {
  const userKeys: string[] = [];

  // Find the api-keys section by looking for lines starting with "  - " after "api-keys:"
  // Normalize line endings first
  const normalizedContent = content.replace(/\r\n/g, '\n');

  // Find the api-keys: line and extract all subsequent key entries
  const lines = normalizedContent.split('\n');
  let inApiKeysSection = false;

  for (const line of lines) {
    // Check if this is the start of api-keys section
    if (line.match(/^api-keys:\s*$/)) {
      inApiKeysSection = true;
      continue;
    }

    // If we're in the api-keys section, look for key entries
    if (inApiKeysSection) {
      // Key entries are indented with "  - " or similar
      const keyMatch = line.match(/^\s+-\s*"([^"]*)"/);
      if (keyMatch) {
        const key = keyMatch[1];
        // Exclude the internal CCS key and empty strings
        if (key && key !== CCS_INTERNAL_API_KEY) {
          userKeys.push(key);
        }
      } else if (line.match(/^\S/) && line.trim().length > 0) {
        // Non-indented line that's not empty means we've left the api-keys section
        break;
      }
      // Continue for blank lines or other indented content
    }
  }

  return userKeys;
}

/**
 * Extract a YAML section from config content by key name.
 * Returns the raw lines (including indented children) or empty string.
 */
function extractYamlSection(content: string, sectionKey: string): string {
  const lines = content.split('\n');
  const sectionLines: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (line.startsWith(`${sectionKey}:`)) {
      inSection = true;
      continue; // Skip the key line itself
    }
    if (inSection) {
      // Section ends at next top-level key (skip comments and blank lines)
      if (line.match(/^\S/) && !line.startsWith('#') && line.trim().length > 0) {
        break;
      }
      sectionLines.push(line);
    }
  }

  // Strip leading/trailing blank lines but preserve indentation
  return sectionLines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/**
 * Force regenerate config.yaml with latest settings.
 * Preserves user-added API keys, claude-api-key section, and port settings.
 *
 * @param port - Default port to use if not found in existing config
 * @returns Path to new config file
 */
export function regenerateConfig(port: number = CLIPROXY_DEFAULT_PORT): string {
  const configPath = getConfigPathForPort(port);

  // Preserve user settings from existing config
  let effectivePort = port;
  let userApiKeys: string[] = [];
  let claudeApiKeySection = '';
  let existingAliases = '';

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');

      // Preserve port setting
      const portMatch = content.match(/^port:\s*(\d+)/m);
      if (portMatch) {
        effectivePort = parseInt(portMatch[1], 10);
      }

      // Preserve user-added API keys (fix for issue #200)
      userApiKeys = parseUserApiKeys(content);

      // Preserve claude-api-key section (managed via dashboard/API)
      claudeApiKeySection = extractYamlSection(content, 'claude-api-key');

      // Preserve existing oauth-model-alias user customizations
      existingAliases = extractYamlSection(content, 'oauth-model-alias');
    } catch {
      // Use defaults if reading fails
    }
    // Delete existing config
    fs.unlinkSync(configPath);
  }

  // Ensure directories exist
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(getAuthDir(), { recursive: true, mode: 0o700 });

  // Generate fresh config with preserved user API keys and aliases
  let configContent = generateUnifiedConfigContent(effectivePort, userApiKeys, existingAliases);

  // Re-append claude-api-key section if it existed
  if (claudeApiKeySection) {
    configContent += `claude-api-key:\n${claudeApiKeySection}\n`;
  }

  fs.writeFileSync(configPath, configContent, { mode: 0o600 });

  return configPath;
}

/**
 * Check if config needs regeneration (version mismatch)
 * @returns true if config should be regenerated
 */
export function configNeedsRegeneration(): boolean {
  const configPath = getConfigPathForPort(CLIPROXY_DEFAULT_PORT);
  if (!fs.existsSync(configPath)) {
    return false; // Will be created on first use
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');

    // Check for version marker
    const versionMatch = content.match(/CCS v(\d+)/);
    if (!versionMatch) {
      return true; // No version marker = old config
    }

    const configVersion = parseInt(versionMatch[1], 10);
    return configVersion < CLIPROXY_CONFIG_VERSION;
  } catch {
    return true; // Error reading = regenerate
  }
}

/**
 * Check if config exists for port
 */
export function configExists(port: number = CLIPROXY_DEFAULT_PORT): boolean {
  return fs.existsSync(getConfigPathForPort(port));
}

/**
 * Delete config file for specific port
 */
export function deleteConfigForPort(port: number): void {
  const configPath = getConfigPathForPort(port);
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

/**
 * Delete config file (default port)
 */
export function deleteConfig(): void {
  deleteConfigForPort(CLIPROXY_DEFAULT_PORT);
}
