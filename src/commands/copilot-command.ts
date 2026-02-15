/**
 * Copilot CLI Command
 *
 * Handles `ccs copilot <subcommand>` commands.
 */

import {
  startAuthFlow,
  getCopilotStatus,
  startDaemon,
  stopDaemon,
  getAvailableModels,
  isCopilotApiInstalled,
} from '../copilot';
import { loadOrCreateUnifiedConfig, saveUnifiedConfig } from '../config/unified-config-loader';
import { DEFAULT_COPILOT_CONFIG } from '../config/unified-config-types';
import { ok, fail, info, color } from '../utils/ui';

export const COPILOT_SUBCOMMANDS = [
  'auth',
  'status',
  'models',
  'start',
  'stop',
  'enable',
  'disable',
  'help',
  '--help',
  '-h',
] as const;

export function isCopilotSubcommand(subcommand: string | undefined): boolean {
  return subcommand ? (COPILOT_SUBCOMMANDS as readonly string[]).includes(subcommand) : false;
}

/**
 * Handle copilot subcommand.
 */
export async function handleCopilotCommand(args: string[]): Promise<number> {
  const { dispatchToolAdapter } = await import('../tools');
  return dispatchToolAdapter('copilot', args);
}

/**
 * Legacy copilot command implementation used by the tool adapter.
 */
export async function handleCopilotCommandLegacy(args: string[]): Promise<number> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'auth':
      return handleAuth();
    case 'status':
      return handleStatus();
    case 'models':
      return handleModels();
    case 'start':
      return handleStart();
    case 'stop':
      return handleStop();
    case 'enable':
      return handleEnable();
    case 'disable':
      return handleDisable();
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return handleHelp();
    default:
      console.error(fail(`Unknown subcommand: ${subcommand}`));
      console.error('');
      return handleHelp();
  }
}

/**
 * Show help for copilot commands.
 */
function handleHelp(): number {
  console.log('GitHub Copilot Integration');
  console.log('');
  console.log('Usage: ccs copilot <subcommand>');
  console.log('');
  console.log('Subcommands:');
  console.log('  auth      Start GitHub OAuth authentication');
  console.log('  status    Show authentication and daemon status');
  console.log('  models    List available models');
  console.log('  start     Start copilot-api daemon');
  console.log('  stop      Stop copilot-api daemon');
  console.log('  enable    Enable copilot integration');
  console.log('  disable   Disable copilot integration');
  console.log('  help      Show this help message');
  console.log('');
  console.log('Quick start:');
  console.log('  1. ccs copilot auth     # Authenticate with GitHub');
  console.log('  2. ccs copilot enable   # Enable integration');
  console.log('  3. ccs copilot start    # Start daemon');
  console.log('');
  console.log('Or use the web UI: ccs config → Copilot tab');
  console.log('');
  return 0;
}

/**
 * Handle auth subcommand.
 */
async function handleAuth(): Promise<number> {
  if (!isCopilotApiInstalled()) {
    console.error(fail('copilot-api is not installed.'));
    console.error('');
    console.error('Install with: npm install -g copilot-api');
    return 1;
  }

  const result = await startAuthFlow();

  if (result.success) {
    console.log('');
    console.log(ok('Authentication successful!'));
    console.log('');
    console.log('Next steps:');
    console.log('  1. Enable copilot: ccs copilot enable');
    console.log('  2. Start daemon:   npx copilot-api start');
    console.log('  3. Use copilot:    ccs copilot');
    return 0;
  } else {
    console.error('');
    console.error(fail(result.error || 'Authentication failed'));
    return 1;
  }
}

/**
 * Handle status subcommand.
 */
async function handleStatus(): Promise<number> {
  const config = loadOrCreateUnifiedConfig();
  const copilotConfig = config.copilot ?? DEFAULT_COPILOT_CONFIG;

  const status = await getCopilotStatus(copilotConfig);

  console.log('GitHub Copilot Status');
  console.log('─────────────────────');
  console.log('');

  // Enabled status
  const enabledIcon = copilotConfig.enabled ? color('[OK]', 'success') : color('[X]', 'error');
  const enabledText = copilotConfig.enabled ? 'Enabled' : 'Disabled';
  console.log(`Integration:    ${enabledIcon} ${enabledText}`);

  // Auth status
  const authIcon = status.auth.authenticated ? color('[OK]', 'success') : color('[X]', 'error');
  const authText = status.auth.authenticated ? 'Authenticated' : 'Not authenticated';
  console.log(`Authentication: ${authIcon} ${authText}`);

  // Daemon status
  const daemonIcon = status.daemon.running ? color('[OK]', 'success') : color('[X]', 'error');
  const daemonText = status.daemon.running ? 'Running' : 'Not running';
  console.log(`Daemon:         ${daemonIcon} ${daemonText}`);

  console.log('');
  console.log('Configuration:');
  console.log(`  Port:         ${copilotConfig.port}`);
  console.log(`  Model:        ${copilotConfig.model}`);
  console.log(`  Account Type: ${copilotConfig.account_type}`);
  console.log(`  Auto-start:   ${copilotConfig.auto_start ? 'Yes' : 'No'}`);

  if (copilotConfig.rate_limit !== null) {
    console.log(`  Rate Limit:   ${copilotConfig.rate_limit}s`);
  }

  console.log('');

  // Show next steps if not fully configured
  if (!copilotConfig.enabled || !status.auth.authenticated || !status.daemon.running) {
    console.log('Next steps:');
    if (!copilotConfig.enabled) {
      console.log('  - Enable:      ccs copilot enable');
    }
    if (!status.auth.authenticated) {
      console.log('  - Auth:        ccs copilot auth');
    }
    if (!status.daemon.running) {
      console.log('  - Start:       ccs copilot start');
    }
  }

  return 0;
}

/**
 * Handle models subcommand.
 */
async function handleModels(): Promise<number> {
  const config = loadOrCreateUnifiedConfig();
  const copilotConfig = config.copilot ?? DEFAULT_COPILOT_CONFIG;

  console.log('Available Copilot Models');
  console.log('────────────────────────');
  console.log('');

  const models = await getAvailableModels(copilotConfig.port);

  for (const model of models) {
    const current = model.id === copilotConfig.model ? ' [CURRENT]' : '';
    const defaultMark = model.isDefault ? ' (default)' : '';
    console.log(`  ${model.id}${current}${defaultMark}`);
    console.log(`    Provider: ${model.provider}`);
  }

  console.log('');
  console.log('To change model: ccs config (Copilot section)');

  return 0;
}

/**
 * Handle start subcommand.
 */
async function handleStart(): Promise<number> {
  const config = loadOrCreateUnifiedConfig();
  const copilotConfig = config.copilot ?? DEFAULT_COPILOT_CONFIG;

  console.log(info(`Starting copilot-api daemon on port ${copilotConfig.port}...`));

  const result = await startDaemon(copilotConfig);

  if (result.success) {
    console.log(ok(`Daemon started (PID: ${result.pid})`));
    return 0;
  } else {
    console.error(fail(result.error || 'Failed to start daemon'));
    return 1;
  }
}

/**
 * Handle stop subcommand.
 */
async function handleStop(): Promise<number> {
  console.log(info('Stopping copilot-api daemon...'));

  const result = await stopDaemon();

  if (result.success) {
    console.log(ok('Daemon stopped'));
    return 0;
  } else {
    console.error(fail(result.error || 'Failed to stop daemon'));
    return 1;
  }
}

/**
 * Handle enable subcommand.
 */
async function handleEnable(): Promise<number> {
  const config = loadOrCreateUnifiedConfig();

  if (!config.copilot) {
    config.copilot = { ...DEFAULT_COPILOT_CONFIG };
  }

  config.copilot.enabled = true;
  saveUnifiedConfig(config);

  console.log(ok('Copilot integration enabled'));
  console.log('');
  console.log('Next steps:');
  console.log('  1. Authenticate: ccs copilot auth');
  console.log('  2. Start daemon: ccs copilot start');
  console.log('  3. Use:          ccs copilot');

  return 0;
}

/**
 * Handle disable subcommand.
 */
async function handleDisable(): Promise<number> {
  const config = loadOrCreateUnifiedConfig();

  if (config.copilot) {
    config.copilot.enabled = false;
    saveUnifiedConfig(config);
  }

  console.log(ok('Copilot integration disabled'));

  return 0;
}
