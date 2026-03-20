import type { SpawnOptions as NodeSpawnOptions } from 'child_process';

/**
 * CLI Runtime Types
 */

/**
 * Parsed CLI arguments
 */
export interface ParsedArgs {
  profile?: string; // Profile name (glm, kimi, work, etc.)
  prompt?: string; // -p/--prompt flag value
  isDelegation: boolean; // -p flag present
  isContinue: boolean; // :continue suffix detected
  remainingArgs: string[]; // Args to pass to Claude CLI
}

/**
 * Spawn options for Claude CLI execution
 */
export interface ClaudeSpawnOptions extends NodeSpawnOptions {
  stdio: 'inherit' | 'pipe';
  windowsHide?: boolean;
  shell?: boolean;
  env: NodeJS.ProcessEnv;
}

/**
 * Platform detection
 */
export type Platform = 'darwin' | 'linux' | 'win32';

/**
 * Claude CLI detection result
 */
export interface ClaudeCliInfo {
  path: string;
  version?: string;
  isWindows: boolean;
  needsShell: boolean; // .cmd/.bat/.ps1 files
}

/**
 * Exit codes
 */
export const ExitCode = {
  SUCCESS: 0,
  GENERIC_ERROR: 1,
  CLAUDE_NOT_FOUND: 127,
  CONFIG_ERROR: 2,
  DELEGATION_ERROR: 3,
  TIMEOUT: 124,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
