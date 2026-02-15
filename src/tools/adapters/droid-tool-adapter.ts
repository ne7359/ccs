import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline/promises';
import { parseFlag, detectShell, formatExportLine } from '../../commands/env-command';
import { getCcsDir } from '../../utils/config-manager';
import { fail, info, ok } from '../../utils/ui';
import type { ToolAdapter } from '../types';

interface DroidConfig {
  endpoint: string;
  profile: string;
  apiKey: string;
  updatedAt: string;
}

const DROID_SUBCOMMANDS = ['setup', 'env', 'doctor', 'help', '--help', '-h'] as const;

function getDroidDir(): string {
  return path.join(getCcsDir(), 'tools', 'droid');
}

function getDroidConfigPath(): string {
  return path.join(getDroidDir(), 'config.json');
}

function createDefaultConfig(): DroidConfig {
  return {
    endpoint: 'http://127.0.0.1:4317',
    profile: 'droid',
    apiKey: '',
    updatedAt: new Date().toISOString(),
  };
}

function readConfig(): DroidConfig {
  const configPath = getDroidConfigPath();
  if (!fs.existsSync(configPath)) {
    return createDefaultConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DroidConfig>;
    return {
      endpoint: parsed.endpoint || 'http://127.0.0.1:4317',
      profile: parsed.profile || 'droid',
      apiKey: parsed.apiKey || '',
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return createDefaultConfig();
  }
}

async function promptWithDefault(label: string, fallback: string): Promise<string> {
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await input.question(`${label} [${fallback}]: `);
    return answer.trim() || fallback;
  } finally {
    input.close();
  }
}

function writeConfigAtomic(config: DroidConfig): void {
  const configPath = getDroidConfigPath();
  const tmpPath = `${configPath}.tmp.${process.pid}`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, configPath);
}

function showHelp(): number {
  console.log('Factory Droid Adapter');
  console.log('');
  console.log('Usage: ccs tool droid <subcommand>');
  console.log('');
  console.log('Subcommands:');
  console.log('  setup        Initialize droid config under ~/.ccs/tools/droid');
  console.log('  env          Print shell exports for droid integration');
  console.log('  doctor       Check droid config health');
  console.log('  help         Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  ccs tool droid setup');
  console.log('  eval "$(ccs tool droid env)"');
  console.log('  ccs tool droid doctor');
  console.log('');
  return 0;
}

async function handleSetup(args: string[]): Promise<number> {
  const profileFlag = parseFlag(args, 'profile');
  const endpointFlag = parseFlag(args, 'endpoint');
  const keyFlag = parseFlag(args, 'key');

  if (endpointFlag && !profileFlag) {
    console.error(fail('--endpoint requires --profile'));
    return 1;
  }
  if (keyFlag && !profileFlag) {
    console.error(fail('--key requires --profile'));
    return 1;
  }

  const existing = readConfig();
  let profile = profileFlag || existing.profile;
  let endpoint = endpointFlag || existing.endpoint;
  let apiKey = keyFlag || existing.apiKey || '';

  const shouldPrompt =
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    (!profileFlag || !endpointFlag || !keyFlag);

  if (shouldPrompt) {
    profile = await promptWithDefault('Droid profile', profile);
    endpoint = await promptWithDefault('Droid endpoint', endpoint);
    apiKey = await promptWithDefault('Droid API key', apiKey || 'none');
    if (apiKey === 'none') {
      apiKey = '';
    }
  }

  const config: DroidConfig = {
    profile: profile.trim() || 'droid',
    endpoint: endpoint.trim() || 'http://127.0.0.1:4317',
    apiKey: apiKey.trim(),
    updatedAt: new Date().toISOString(),
  };
  writeConfigAtomic(config);

  console.log(ok(`Droid config ready: ${getDroidConfigPath()}`));
  return 0;
}

function isValidShellInput(value: string): boolean {
  return ['auto', 'bash', 'zsh', 'fish', 'powershell'].includes(value);
}

function handleEnv(args: string[]): number {
  const shellInput = parseFlag(args, 'shell') || 'auto';

  if (!isValidShellInput(shellInput)) {
    console.error(fail(`Invalid shell: ${shellInput}. Use: auto, bash, zsh, fish, powershell`));
    return 1;
  }

  const shell = detectShell(shellInput === 'zsh' ? 'bash' : shellInput);
  const droidDir = getDroidDir();
  const configPath = getDroidConfigPath();
  const config = readConfig();

  const exportsMap: Record<string, string> = {
    DROID_HOME: droidDir,
    DROID_CONFIG: configPath,
    DROID_ENDPOINT: config.endpoint,
    DROID_PROFILE: config.profile,
  };

  if (config.apiKey) {
    exportsMap['DROID_API_KEY'] = config.apiKey;
  }

  for (const [key, value] of Object.entries(exportsMap)) {
    console.log(formatExportLine(shell, key, value));
  }

  return 0;
}

function handleDoctor(): number {
  const droidDir = getDroidDir();
  const configPath = getDroidConfigPath();

  console.log(info('Running droid diagnostics...'));

  let healthy = true;

  if (fs.existsSync(droidDir)) {
    console.log(ok(`Directory exists: ${droidDir}`));
  } else {
    console.error(fail(`Directory missing: ${droidDir}`));
    healthy = false;
  }

  if (fs.existsSync(configPath)) {
    console.log(ok(`Config exists: ${configPath}`));
  } else {
    console.error(fail(`Config missing: ${configPath}`));
    healthy = false;
  }

  const config = readConfig();
  if (config.endpoint) {
    console.log(ok(`Endpoint configured: ${config.endpoint}`));
  } else {
    console.error(fail('Endpoint is empty in droid config'));
    healthy = false;
  }
  if (config.profile) {
    console.log(ok(`Profile configured: ${config.profile}`));
  } else {
    console.error(fail('Profile is empty in droid config'));
    healthy = false;
  }

  return healthy ? 0 : 1;
}

async function handleDroidCommand(args: string[]): Promise<number> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'setup':
      return handleSetup(args.slice(1));
    case 'env':
      return handleEnv(args.slice(1));
    case 'doctor':
      return handleDoctor();
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return showHelp();
    default:
      console.error(fail(`Unknown droid subcommand: ${subcommand}`));
      console.error('');
      console.error(`Use one of: ${DROID_SUBCOMMANDS.join(', ')}`);
      return 1;
  }
}

export const droidToolAdapter: ToolAdapter = {
  id: 'droid',
  summary: 'Factory droid integration commands',
  subcommands: DROID_SUBCOMMANDS,
  run: handleDroidCommand,
};
