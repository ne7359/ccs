/**
 * Path resolution utilities for CLIProxy directories and files
 * Centralizes all path management for CLIProxy configuration
 */

import * as path from 'path';
import { getCcsDir } from '../../utils/config-manager';
import type { CLIProxyProvider } from '../types';
import { CLIPROXY_DEFAULT_PORT } from './port-manager';

/**
 * Get CLIProxy base directory
 * All CLIProxy-related files are stored under ~/.ccs/cliproxy/
 */
export function getCliproxyDir(): string {
  return path.join(getCcsDir(), 'cliproxy');
}

/**
 * Get CLIProxy writable directory for logs and runtime files.
 * This directory is set as WRITABLE_PATH env var when spawning CLIProxy.
 * Logs will be stored in ~/.ccs/cliproxy/logs/
 */
export function getCliproxyWritablePath(): string {
  return path.join(getCcsDir(), 'cliproxy');
}

/**
 * Get base auth directory for CLIProxyAPI
 */
export function getAuthDir(): string {
  return path.join(getCliproxyDir(), 'auth');
}

/**
 * Get auth directory for provider
 * All providers use a FLAT auth directory structure for unified config.
 * CLIProxyAPI stores OAuth tokens directly in auth/ (not subdirectories).
 * This enables all providers to be discovered and used concurrently.
 */
export function getProviderAuthDir(_provider: CLIProxyProvider): string {
  // Use flat structure - all auth files in same directory for unified discovery
  // Provider param kept for API compatibility (CLIProxyAPI handles via auth file type field)
  return path.join(getCliproxyDir(), 'auth');
}

/**
 * Get config file path for a specific port.
 * Default port uses config.yaml, others use config-{port}.yaml.
 */
export function getConfigPathForPort(port: number): string {
  if (port === CLIPROXY_DEFAULT_PORT) {
    return path.join(getCliproxyDir(), 'config.yaml');
  }
  return path.join(getCliproxyDir(), `config-${port}.yaml`);
}

/**
 * Get CLIProxy config file path (default port)
 * Named distinctly from config-manager's getConfigPath to avoid confusion.
 */
export function getCliproxyConfigPath(): string {
  return getConfigPathForPort(CLIPROXY_DEFAULT_PORT);
}

/**
 * Get binary directory path
 */
export function getBinDir(): string {
  return path.join(getCliproxyDir(), 'bin');
}

/**
 * Get path to user settings file for provider
 * Example: ~/.ccs/gemini.settings.json
 */
export function getProviderSettingsPath(provider: CLIProxyProvider): string {
  return path.join(getCcsDir(), `${provider}.settings.json`);
}
