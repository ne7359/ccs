/**
 * Shell Executor Utilities
 *
 * Cross-platform shell execution utilities for CCS.
 */

import { spawn, spawnSync, ChildProcess } from 'child_process';
import { ErrorManager } from './error-manager';
import { getWebSearchHookEnv } from './websearch-manager';
import { wireChildProcessSignals } from './signal-forwarder';
import { loadOrCreateUnifiedConfig } from '../config/unified-config-loader';
import SharedManager from '../management/shared-manager';

/**
 * Strip ANTHROPIC_* env vars from an environment object.
 * Used for account/default profiles to prevent stale proxy config from
 * interfering with native Claude API routing.
 */
export function stripAnthropicEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(env)) {
    if (!key.startsWith('ANTHROPIC_')) {
      result[key] = env[key];
    }
  }
  return result;
}

/**
 * Strip Claude Code nested-session guard env var from a process environment.
 *
 * Note: Windows env keys are case-insensitive, so remove case-insensitively
 * to avoid missing variants like `claudecode`.
 */
export function stripClaudeCodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() !== 'CLAUDECODE') {
      result[key] = env[key];
    }
  }
  return result;
}

/**
 * Resolve CCS-managed environment overrides for Claude launch.
 * - preferences.auto_update: false -> DISABLE_AUTOUPDATER=1
 */
export function getClaudeLaunchEnvOverrides(): NodeJS.ProcessEnv {
  try {
    const config = loadOrCreateUnifiedConfig();
    if (config.preferences?.auto_update === false) {
      return { DISABLE_AUTOUPDATER: '1' };
    }
  } catch {
    // Config read errors should never block Claude launch.
  }
  return {};
}

/**
 * Escape arguments for shell execution (cross-platform)
 *
 * IMPORTANT: On Windows, spawn({ shell: true }) uses cmd.exe by default,
 * NOT PowerShell. cmd.exe does NOT recognize single quotes as string delimiters.
 * We must use double quotes for cmd.exe compatibility.
 */
export function escapeShellArg(arg: string): string {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // cmd.exe: Use double quotes, escape inner double quotes by doubling them
    // cmd.exe interprets "" as escaped double quote inside quoted string
    // Strip newlines/tabs that can break cmd.exe parsing
    return (
      '"' +
      String(arg)
        .replace(/[\r\n\t]/g, ' ') // Replace newlines/tabs with space
        .replace(/%/g, '%%') // Escape percent signs
        .replace(/\^/g, '^^') // Escape carets
        .replace(/!/g, '^^!') // Escape exclamation marks (delayed expansion)
        .replace(/"/g, '""') + // Escape quotes
      '"'
    );
  } else {
    // Unix/macOS: Double quotes with escaped inner quotes
    return '"' + String(arg).replace(/"/g, '\\"') + '"';
  }
}

/**
 * Execute Claude CLI with unified spawn logic
 */
export function execClaude(
  claudeCli: string,
  args: string[],
  envVars: NodeJS.ProcessEnv | null = null
): void {
  const isWindows = process.platform === 'win32';
  const isPowerShellScript = isWindows && /\.ps1$/i.test(claudeCli);
  const needsShell = isWindows && /\.(cmd|bat)$/i.test(claudeCli);

  // Get WebSearch hook config env vars
  const webSearchEnv = getWebSearchHookEnv();
  const claudeLaunchEnv = getClaudeLaunchEnvOverrides();

  // For account/default profiles, strip ANTHROPIC_* from parent env to prevent
  // stale proxy config (e.g., from prior CLIProxy sessions) from interfering
  // with native Claude API routing. Settings-based profiles explicitly inject
  // their own ANTHROPIC_* values, so they don't need this protection.
  const profileType = envVars?.CCS_PROFILE_TYPE;
  const baseEnv =
    profileType === 'account' || profileType === 'default'
      ? stripAnthropicEnv(process.env)
      : process.env;

  // Prepare environment (merge with base env if envVars provided)
  const mergedEnv = envVars
    ? { ...baseEnv, ...claudeLaunchEnv, ...envVars, ...webSearchEnv }
    : { ...baseEnv, ...claudeLaunchEnv, ...webSearchEnv };

  // Strip Claude Code nested session guard env var to allow CCS delegation
  // (Claude Code v2.1.39+ sets CLAUDECODE to detect nested sessions)
  const env = stripClaudeCodeEnv(mergedEnv);

  if (profileType !== 'account') {
    try {
      new SharedManager().normalizeSharedPluginMetadataPaths(env.CLAUDE_CONFIG_DIR);
    } catch {
      // Best-effort normalization should never block Claude launch.
    }
  }

  // propagate key env vars to tmux session so agent team teammates
  // (spawned via tmux split-window) inherit the correct config dir
  if (process.env.TMUX && envVars) {
    const tmuxPropagateVars = ['CLAUDE_CONFIG_DIR', 'CCS_PROFILE_TYPE', 'CCS_WEBSEARCH_SKIP'];
    for (const key of tmuxPropagateVars) {
      if (envVars[key]) {
        try {
          spawnSync('tmux', ['setenv', key, envVars[key] ?? ''], { stdio: 'ignore' });
        } catch {
          // tmux setenv can fail if not in a tmux session; safe to ignore
        }
      }
    }
  }

  let child: ChildProcess;
  if (isPowerShellScript) {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', claudeCli, ...args],
      {
        stdio: 'inherit',
        windowsHide: true,
        env,
      }
    );
  } else if (needsShell) {
    // When shell needed: concatenate into string to avoid DEP0190 warning
    const cmdString = [claudeCli, ...args].map(escapeShellArg).join(' ');
    child = spawn(cmdString, {
      stdio: 'inherit',
      windowsHide: true,
      shell: true,
      env,
    });
  } else {
    // When no shell needed: use array form (faster, no shell overhead)
    child = spawn(claudeCli, args, {
      stdio: 'inherit',
      windowsHide: true,
      env,
    });
  }

  wireChildProcessSignals(child, async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EACCES') {
      console.error(`[X] Claude CLI is not executable: ${claudeCli}`);
      console.error('    Check file permissions and executable bit.');
    } else if (err.code === 'ENOENT') {
      if (isPowerShellScript) {
        console.error('[X] PowerShell executable not found (required for .ps1 wrapper launch).');
        console.error('    Ensure powershell.exe is available in PATH.');
      } else if (needsShell) {
        console.error('[X] Windows command shell not found for Claude wrapper launch.');
        console.error('    Ensure cmd.exe is available and accessible.');
      } else {
        await ErrorManager.showClaudeNotFound();
      }
    } else {
      console.error(`[X] Failed to start Claude CLI (${claudeCli}): ${err.message}`);
    }
    process.exit(1);
  });
}
