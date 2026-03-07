/**
 * API Command Handler
 *
 * Manages CCS API profiles for custom API providers.
 * Commands: create, list, remove
 *
 * CLI parsing and output formatting only.
 * Business logic delegated to src/api/services/.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  initUI,
  header,
  subheader,
  color,
  dim,
  ok,
  fail,
  warn,
  info,
  table,
  infoBox,
} from '../utils/ui';
import { InteractivePrompt } from '../utils/prompt';
import {
  validateApiName,
  validateUrl,
  getUrlWarning,
  sanitizeBaseUrl,
  apiProfileExists,
  listApiProfiles,
  createApiProfile,
  removeApiProfile,
  getApiProfileNames,
  isUsingUnifiedConfig,
  isOpenRouterUrl,
  pickOpenRouterModel,
  PROVIDER_PRESETS,
  getPresetById,
  getPresetAliases,
  getPresetIds,
  discoverApiProfileOrphans,
  registerApiProfileOrphans,
  copyApiProfile,
  exportApiProfile,
  importApiProfileBundle,
  type ModelMapping,
  type ProviderPreset,
} from '../api/services';
import { syncToLocalConfig } from '../cliproxy/sync/local-config-sync';
import type { TargetType } from '../targets/target-adapter';
import { extractOption, hasAnyFlag } from './arg-extractor';

interface ApiCommandArgs {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  preset?: string;
  target?: TargetType;
  force?: boolean;
  yes?: boolean;
  errors: string[];
}

const API_BOOLEAN_FLAGS = ['--force', '--yes', '-y'] as const;
const API_VALUE_FLAGS = ['--base-url', '--api-key', '--model', '--preset', '--target'] as const;
const API_KNOWN_FLAGS: readonly string[] = [...API_BOOLEAN_FLAGS, ...API_VALUE_FLAGS];
const API_VALUE_FLAG_SET = new Set<string>(API_VALUE_FLAGS);

function sanitizeHelpText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderPresetHelpLine(preset: ProviderPreset, idWidth: number): string {
  const presetId = sanitizeHelpText(preset.id) || 'unknown';
  const paddedId = presetId.padEnd(idWidth);
  const presetName = sanitizeHelpText(preset.name) || 'Unknown preset';
  const presetDescription = sanitizeHelpText(preset.description) || 'No description';
  return `  ${color(paddedId, 'command')} ${presetName} - ${presetDescription}`;
}

function applyRepeatedOption(
  args: string[],
  flags: readonly string[],
  onValue: (value: string) => void,
  onMissing: () => void
): string[] {
  let remaining = [...args];

  while (true) {
    const extracted = extractOption(remaining, flags, {
      allowDashValue: true,
      knownFlags: API_KNOWN_FLAGS,
    });
    if (!extracted.found) {
      return remaining;
    }

    if (extracted.missingValue || !extracted.value) {
      onMissing();
    } else {
      onValue(extracted.value);
    }

    remaining = extracted.remainingArgs;
  }
}

function extractPositionalArgs(args: string[]): string[] {
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }

    if (token.startsWith('-')) {
      if (!token.includes('=') && API_VALUE_FLAG_SET.has(token)) {
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          i++;
        }
      }
      continue;
    }

    positionals.push(token);
  }

  return positionals;
}

function parseTargetValue(value: string): TargetType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'droid') {
    return normalized;
  }
  return null;
}

function parseOptionalTargetFlag(
  args: string[],
  knownFlags: readonly string[]
): { target?: TargetType; remainingArgs: string[]; errors: string[] } {
  const extracted = extractOption(args, ['--target'], {
    allowDashValue: true,
    knownFlags,
  });
  if (!extracted.found) {
    return { remainingArgs: args, errors: [] };
  }
  if (extracted.missingValue || !extracted.value) {
    return { remainingArgs: extracted.remainingArgs, errors: ['Missing value for --target'] };
  }
  const target = parseTargetValue(extracted.value);
  if (!target) {
    return {
      remainingArgs: extracted.remainingArgs,
      errors: [`Invalid --target value "${extracted.value}". Use: claude or droid`],
    };
  }
  return { target, remainingArgs: extracted.remainingArgs, errors: [] };
}

/** Parse command line arguments for api commands */
export function parseApiCommandArgs(args: string[]): ApiCommandArgs {
  const result: ApiCommandArgs = {
    force: hasAnyFlag(args, ['--force']),
    yes: hasAnyFlag(args, ['--yes', '-y']),
    errors: [],
  };

  let remaining = [...args];

  remaining = applyRepeatedOption(
    remaining,
    ['--base-url'],
    (value) => {
      result.baseUrl = value;
    },
    () => {
      result.errors.push('Missing value for --base-url');
    }
  );

  remaining = applyRepeatedOption(
    remaining,
    ['--api-key'],
    (value) => {
      result.apiKey = value;
    },
    () => {
      result.errors.push('Missing value for --api-key');
    }
  );

  remaining = applyRepeatedOption(
    remaining,
    ['--model'],
    (value) => {
      result.model = value;
    },
    () => {
      result.errors.push('Missing value for --model');
    }
  );

  remaining = applyRepeatedOption(
    remaining,
    ['--preset'],
    (value) => {
      result.preset = value;
    },
    () => {
      result.errors.push('Missing value for --preset');
    }
  );

  remaining = applyRepeatedOption(
    remaining,
    ['--target'],
    (value) => {
      const target = parseTargetValue(value);
      if (!target) {
        result.errors.push(`Invalid --target value "${value}". Use: claude or droid`);
        return;
      }
      result.target = target;
    },
    () => {
      result.errors.push('Missing value for --target');
    }
  );

  const positionalArgs = extractPositionalArgs(remaining);
  result.name = positionalArgs[0];
  return result;
}

/** Handle 'ccs api create' command */
async function handleCreate(args: string[]): Promise<void> {
  await initUI();
  const parsedArgs = parseApiCommandArgs(args);

  if (parsedArgs.errors.length > 0) {
    parsedArgs.errors.forEach((errorMessage) => {
      console.log(fail(errorMessage));
    });
    process.exit(1);
  }

  console.log(header('Create API Profile'));
  console.log('');

  // Handle --preset option for quick provider setup
  const preset = parsedArgs.preset ? getPresetById(parsedArgs.preset) : null;
  if (parsedArgs.preset && !preset) {
    console.log(fail(`Unknown preset: ${parsedArgs.preset}`));
    console.log('');
    console.log('Available presets:');
    getPresetIds().forEach((id) => console.log(`  - ${sanitizeHelpText(id)}`));
    process.exit(1);
  }

  // Step 1: API name (use preset default if --preset provided)
  let name = parsedArgs.name || preset?.defaultProfileName;
  if (!name) {
    name = await InteractivePrompt.input('API name', {
      validate: validateApiName,
    });
  } else {
    const error = validateApiName(name);
    if (error) {
      console.log(fail(error));
      process.exit(1);
    }
  }

  // Check if exists
  if (apiProfileExists(name) && !parsedArgs.force) {
    console.log(fail(`API '${name}' already exists`));
    console.log(`    Use ${color('--force', 'command')} to overwrite`);
    process.exit(1);
  }

  // Step 2: Base URL (use preset if provided; skip prompt for presets with empty baseUrl like anthropic)
  let baseUrl = parsedArgs.baseUrl ?? preset?.baseUrl ?? '';
  if (!baseUrl && !preset) {
    baseUrl = await InteractivePrompt.input(
      'API Base URL (e.g., https://api.example.com/v1 - without /chat/completions)',
      { validate: validateUrl }
    );
  } else if (!preset) {
    // Only validate custom URLs, not preset URLs
    const error = validateUrl(baseUrl);
    if (error) {
      console.log(fail(error));
      process.exit(1);
    }
  }

  // Check for common URL mistakes and warn (skip for presets)
  if (!preset) {
    const urlWarning = getUrlWarning(baseUrl);
    if (urlWarning) {
      console.log('');
      console.log(warn(urlWarning));
      const continueAnyway = await InteractivePrompt.confirm('Continue with this URL anyway?', {
        default: false,
      });
      if (!continueAnyway) {
        baseUrl = await InteractivePrompt.input('API Base URL', {
          validate: validateUrl,
          default: sanitizeBaseUrl(baseUrl),
        });
      }
    }
  } else {
    // Show preset info
    console.log(info(`Using preset: ${preset.name}`));
    console.log(dim(`  ${preset.description}`));
    if (preset.baseUrl) {
      console.log(dim(`  Base URL: ${preset.baseUrl}`));
    } else {
      console.log(dim(`  Auth: Native Anthropic API (x-api-key header)`));
    }
    console.log('');
  }

  // Auto-detect Anthropic direct API when user enters api.anthropic.com URL without preset
  if (baseUrl && baseUrl.includes('api.anthropic.com') && !preset) {
    console.log('');
    console.log(info('Anthropic Direct API detected. Base URL will be omitted for native auth.'));
    baseUrl = '';
  }

  // OpenRouter detection: offer interactive model picker
  let openRouterModel: string | undefined;
  let openRouterTierMapping: { opus?: string; sonnet?: string; haiku?: string } | undefined;

  if (isOpenRouterUrl(baseUrl) && !parsedArgs.model) {
    console.log('');
    console.log(info('OpenRouter detected!'));

    const useInteractive = await InteractivePrompt.confirm('Browse models interactively?', {
      default: true,
    });

    if (useInteractive) {
      const selection = await pickOpenRouterModel();

      if (selection) {
        openRouterModel = selection.model;
        openRouterTierMapping = selection.tierMapping;
      }
    }

    console.log('');
    console.log(dim('Note: For OpenRouter, ANTHROPIC_API_KEY should be empty.'));
  }

  // Step 3: API Key (skip if preset has requiresApiKey: false)
  let apiKey = parsedArgs.apiKey;

  if (preset?.requiresApiKey === false) {
    // Preset doesn't require API key (e.g., local Ollama)
    if (parsedArgs.apiKey) {
      console.log(dim('Note: Using provided API key for local Ollama (optional)'));
      apiKey = parsedArgs.apiKey;
    } else {
      console.log(info('No API key required for local Ollama'));
      // Sentinel value 'ollama' matches config/base-ollama.settings.json template
      // This is not a valid API key, just a placeholder for local-only providers
      apiKey = 'ollama';
    }
  } else if (!apiKey) {
    const keyPrompt = preset?.apiKeyHint ? `API Key (${preset.apiKeyHint})` : 'API Key';
    apiKey = await InteractivePrompt.password(keyPrompt);
    if (!apiKey) {
      console.log(fail('API key is required'));
      process.exit(1);
    }
  }

  // Step 4: Model configuration (use preset default if available)
  const defaultModel = preset?.defaultModel || 'claude-sonnet-4-6';
  let model = parsedArgs.model || openRouterModel || preset?.defaultModel;
  if (!model && !parsedArgs.yes && !preset) {
    model = await InteractivePrompt.input('Default model (ANTHROPIC_MODEL)', {
      default: defaultModel,
    });
  }
  model = model || defaultModel;

  // Step 5: Model mapping for Opus/Sonnet/Haiku (skip prompt for presets with --yes)
  let opusModel = openRouterTierMapping?.opus || model;
  let sonnetModel = openRouterTierMapping?.sonnet || model;
  let haikuModel = openRouterTierMapping?.haiku || model;
  const isCustomModel = model !== defaultModel;
  const hasOpenRouterTierMapping = openRouterTierMapping !== undefined;
  const hasPreset = preset !== null;

  if (!parsedArgs.yes && !hasOpenRouterTierMapping && !hasPreset) {
    let wantCustomMapping = isCustomModel;

    if (!isCustomModel) {
      console.log('');
      console.log(dim('Some API proxies route different model types to different backends.'));
      wantCustomMapping = await InteractivePrompt.confirm(
        'Configure different models for Opus/Sonnet/Haiku?',
        { default: false }
      );
    }

    if (wantCustomMapping) {
      console.log('');
      console.log(
        dim(
          isCustomModel
            ? 'Configure model IDs for each tier (defaults to your model):'
            : 'Leave blank to use the default model for each.'
        )
      );
      opusModel =
        (await InteractivePrompt.input('Opus model (ANTHROPIC_DEFAULT_OPUS_MODEL)', {
          default: model,
        })) || model;
      sonnetModel =
        (await InteractivePrompt.input('Sonnet model (ANTHROPIC_DEFAULT_SONNET_MODEL)', {
          default: model,
        })) || model;
      haikuModel =
        (await InteractivePrompt.input('Haiku model (ANTHROPIC_DEFAULT_HAIKU_MODEL)', {
          default: model,
        })) || model;
    }
  }

  const models: ModelMapping = {
    default: model,
    opus: opusModel,
    sonnet: sonnetModel,
    haiku: haikuModel,
  };
  let resolvedTarget: TargetType = parsedArgs.target || 'claude';

  if (!parsedArgs.target && !parsedArgs.yes) {
    const useDroidByDefault = await InteractivePrompt.confirm(
      'Set default target to Factory Droid for this profile?',
      { default: false }
    );
    if (useDroidByDefault) {
      resolvedTarget = 'droid';
    }
  }

  // Create profile
  console.log('');
  console.log(info('Creating API profile...'));

  const result = createApiProfile(name, baseUrl || '', apiKey, models, resolvedTarget);

  if (!result.success) {
    console.log(fail(`Failed to create API profile: ${result.error}`));
    process.exit(1);
  }

  // Trigger sync to local CLIProxy config (best-effort)
  try {
    syncToLocalConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(`[i] Auto-sync to CLIProxy config skipped: ${message}`);
  }

  // Display success
  console.log('');
  const hasCustomMapping = opusModel !== model || sonnetModel !== model || haikuModel !== model;
  let infoMsg =
    `API:      ${name}\n` +
    `Config:   ${isUsingUnifiedConfig() ? '~/.ccs/config.yaml' : '~/.ccs/config.json'}\n` +
    `Settings: ${result.settingsFile}\n` +
    `Base URL: ${baseUrl}\n` +
    `Model:    ${model}\n` +
    `Target:   ${resolvedTarget}`;

  if (hasCustomMapping) {
    infoMsg +=
      `\n\nModel Mapping:\n` +
      `  Opus:   ${opusModel}\n` +
      `  Sonnet: ${sonnetModel}\n` +
      `  Haiku:  ${haikuModel}`;
  }

  console.log(infoBox(infoMsg, 'API Profile Created'));
  console.log('');
  console.log(header('Usage'));
  if (resolvedTarget === 'droid') {
    console.log(
      `  ${color(`ccs ${name} "your prompt"`, 'command')} ${dim('# uses droid by default')}`
    );
    console.log(
      `  ${color(`ccsd ${name} "your prompt"`, 'command')} ${dim('# explicit droid alias')}`
    );
    console.log(
      `  ${color(`ccs ${name} --target claude "your prompt"`, 'command')} ${dim('# override to Claude')}`
    );
  } else {
    console.log(
      `  ${color(`ccs ${name} "your prompt"`, 'command')} ${dim('# uses claude by default')}`
    );
    console.log(
      `  ${color(`ccs ${name} --target droid "your prompt"`, 'command')} ${dim('# run on droid for this call')}`
    );
  }
  console.log('');
  console.log(header('Edit Settings'));
  console.log(`  ${dim('To modify env vars later:')}`);
  console.log(`  ${color(`nano ${result.settingsFile.replace('~', '$HOME')}`, 'command')}`);
  console.log('');
}

/** Handle 'ccs api list' command */
async function handleList(): Promise<void> {
  await initUI();

  console.log(header('CCS API Profiles'));
  console.log('');

  const { profiles, variants } = listApiProfiles();

  if (profiles.length === 0) {
    console.log(warn('No API profiles configured'));
    console.log('');
    console.log('To create an API profile:');
    console.log(`  ${color('ccs api create', 'command')}`);
    console.log('');
    return;
  }

  // Build table data
  const rows: string[][] = profiles.map((p) => {
    const status = p.isConfigured ? color('[OK]', 'success') : color('[!]', 'warning');
    return [p.name, p.target, p.settingsPath, status];
  });

  const colWidths = isUsingUnifiedConfig() ? [15, 10, 20, 10] : [15, 10, 35, 10];
  console.log(
    table(rows, {
      head: ['API', 'Target', isUsingUnifiedConfig() ? 'Config' : 'Settings File', 'Status'],
      colWidths,
    })
  );
  console.log('');

  // Show CLIProxy variants if any
  if (variants.length > 0) {
    console.log(subheader('CLIProxy Variants'));
    const cliproxyRows = variants.map((v) => [v.name, v.provider, v.target, v.settings]);
    console.log(
      table(cliproxyRows, {
        head: ['Variant', 'Provider', 'Target', 'Settings'],
        colWidths: [15, 12, 10, 28],
      })
    );
    console.log('');
  }

  console.log(dim(`Total: ${profiles.length} API profile(s)`));
  console.log('');
}

/** Handle 'ccs api remove' command */
async function handleRemove(args: string[]): Promise<void> {
  await initUI();
  const parsedArgs = parseApiCommandArgs(args);

  if (parsedArgs.errors.length > 0) {
    parsedArgs.errors.forEach((errorMessage) => {
      console.log(fail(errorMessage));
    });
    process.exit(1);
  }

  const apis = getApiProfileNames();

  if (apis.length === 0) {
    console.log(warn('No API profiles to remove'));
    process.exit(0);
  }

  // Interactive API selection if not provided
  let name = parsedArgs.name;
  if (!name) {
    console.log(header('Remove API Profile'));
    console.log('');
    console.log('Available APIs:');
    apis.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log('');

    name = await InteractivePrompt.input('API name to remove', {
      validate: (val) => {
        if (!val) return 'API name is required';
        if (!apis.includes(val)) return `API '${val}' not found`;
        return null;
      },
    });
  }

  if (!apis.includes(name)) {
    console.log(fail(`API '${name}' not found`));
    console.log('');
    console.log('Available APIs:');
    apis.forEach((p) => console.log(`  - ${p}`));
    process.exit(1);
  }

  // Confirm deletion
  console.log('');
  console.log(`API '${color(name, 'command')}' will be removed.`);
  console.log(`  Settings: ~/.ccs/${name}.settings.json`);
  if (isUsingUnifiedConfig()) {
    console.log('  Config: ~/.ccs/config.yaml');
  }
  console.log('');

  const confirmed =
    parsedArgs.yes ||
    (await InteractivePrompt.confirm('Delete this API profile?', { default: false }));

  if (!confirmed) {
    console.log(info('Cancelled'));
    process.exit(0);
  }

  const result = removeApiProfile(name);

  if (!result.success) {
    console.log(fail(`Failed to remove API profile: ${result.error}`));
    process.exit(1);
  }

  console.log(ok(`API profile removed: ${name}`));
  console.log('');
}

/** Handle 'ccs api discover' command */
async function handleDiscover(args: string[]): Promise<void> {
  await initUI();
  const register = hasAnyFlag(args, ['--register']);
  const jsonOutput = hasAnyFlag(args, ['--json']);
  const force = hasAnyFlag(args, ['--force']);

  const targetParsed = parseOptionalTargetFlag(args, [...API_KNOWN_FLAGS, '--register', '--json']);
  if (targetParsed.errors.length > 0) {
    targetParsed.errors.forEach((errorMessage) => console.log(fail(errorMessage)));
    process.exit(1);
  }

  const result = discoverApiProfileOrphans();
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(header('Discover Orphan API Profiles'));
  console.log('');

  if (result.orphans.length === 0) {
    console.log(ok('No orphan settings files found.'));
    console.log('');
    return;
  }

  const rows = result.orphans.map((orphan) => {
    const status = orphan.validation.valid ? color('[OK]', 'success') : color('[X]', 'error');
    const issueSummary =
      orphan.validation.issues.length > 0
        ? orphan.validation.issues[0].message
        : 'Ready to register';
    return [orphan.name, status, issueSummary];
  });

  console.log(
    table(rows, {
      head: ['Profile', 'Status', 'Validation'],
      colWidths: [20, 10, 64],
    })
  );
  console.log('');

  if (!register) {
    console.log(info('To register discovered profiles:'));
    console.log(`  ${color('ccs api discover --register', 'command')}`);
    console.log('');
    return;
  }

  const registration = registerApiProfileOrphans({
    target: targetParsed.target || 'claude',
    force,
  });
  console.log(ok(`Registered: ${registration.registered.length}`));
  if (registration.skipped.length > 0) {
    console.log(warn(`Skipped: ${registration.skipped.length}`));
    registration.skipped.forEach((item) => {
      console.log(`  - ${item.name}: ${item.reason}`);
    });
  }
  console.log('');
}

/** Handle 'ccs api copy' command */
async function handleCopy(args: string[]): Promise<void> {
  await initUI();
  const parsedArgs = parseApiCommandArgs(args);
  if (parsedArgs.errors.length > 0) {
    parsedArgs.errors.forEach((errorMessage) => console.log(fail(errorMessage)));
    process.exit(1);
  }

  const positionals = extractPositionalArgs(args);
  const source = positionals[0];
  let destination = positionals[1];

  if (!source) {
    console.log(fail('Source profile is required. Usage: ccs api copy <source> <destination>'));
    process.exit(1);
  }

  if (!destination) {
    destination = await InteractivePrompt.input('Destination profile name');
  }

  if (!parsedArgs.yes) {
    const confirmed = await InteractivePrompt.confirm(
      `Copy profile "${source}" to "${destination}"?`,
      { default: true }
    );
    if (!confirmed) {
      console.log(info('Cancelled'));
      process.exit(0);
    }
  }

  const result = copyApiProfile(source, destination, {
    target: parsedArgs.target,
    force: parsedArgs.force,
  });

  if (!result.success) {
    console.log(fail(result.error || 'Failed to copy profile'));
    process.exit(1);
  }

  console.log(ok(`Profile copied: ${source} -> ${destination}`));
  if (result.warnings && result.warnings.length > 0) {
    result.warnings.forEach((warningMessage) => console.log(warn(warningMessage)));
  }
  console.log('');
}

/** Handle 'ccs api export' command */
async function handleExport(args: string[]): Promise<void> {
  await initUI();
  const includeSecrets = hasAnyFlag(args, ['--include-secrets']);

  const outExtracted = extractOption(args, ['--out'], {
    allowDashValue: true,
    knownFlags: [...API_KNOWN_FLAGS, '--out', '--include-secrets'],
  });
  if (outExtracted.found && (outExtracted.missingValue || !outExtracted.value)) {
    console.log(fail('Missing value for --out'));
    process.exit(1);
  }
  const outPath = outExtracted.value;
  const positionals = extractPositionalArgs(outExtracted.remainingArgs);
  const name = positionals[0];

  if (!name) {
    console.log(fail('Profile name is required. Usage: ccs api export <name> [--out <file>]'));
    process.exit(1);
  }

  const result = exportApiProfile(name, includeSecrets);
  if (!result.success || !result.bundle) {
    console.log(fail(result.error || 'Failed to export profile'));
    process.exit(1);
  }

  const resolvedOutputPath = path.resolve(outPath || `${name}.ccs-profile.json`);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, JSON.stringify(result.bundle, null, 2) + '\n', 'utf8');

  console.log(ok(`Profile exported to: ${resolvedOutputPath}`));
  if (result.redacted) {
    console.log(warn('Token was redacted in export. Use --include-secrets to include it.'));
  }
  console.log('');
}

/** Handle 'ccs api import' command */
async function handleImport(args: string[]): Promise<void> {
  await initUI();
  const force = hasAnyFlag(args, ['--force']);
  const yes = hasAnyFlag(args, ['--yes', '-y']);

  const nameExtracted = extractOption(args, ['--name'], {
    allowDashValue: true,
    knownFlags: [...API_KNOWN_FLAGS, '--name'],
  });
  if (nameExtracted.found && (nameExtracted.missingValue || !nameExtracted.value)) {
    console.log(fail('Missing value for --name'));
    process.exit(1);
  }

  const targetParsed = parseOptionalTargetFlag(nameExtracted.remainingArgs, [
    ...API_KNOWN_FLAGS,
    '--name',
  ]);
  if (targetParsed.errors.length > 0) {
    targetParsed.errors.forEach((errorMessage) => console.log(fail(errorMessage)));
    process.exit(1);
  }

  const positionals = extractPositionalArgs(targetParsed.remainingArgs);
  const importPath = positionals[0];
  if (!importPath) {
    console.log(
      fail('Import file path is required. Usage: ccs api import <file> [--name <new-name>]')
    );
    process.exit(1);
  }

  if (!fs.existsSync(importPath)) {
    console.log(fail(`File not found: ${importPath}`));
    process.exit(1);
  }

  const raw = fs.readFileSync(importPath, 'utf8');
  let bundle: unknown;
  try {
    bundle = JSON.parse(raw);
  } catch (error) {
    console.log(fail(`Invalid JSON file: ${(error as Error).message}`));
    process.exit(1);
  }

  if (!yes) {
    const confirmed = await InteractivePrompt.confirm(
      `Import profile bundle from "${importPath}"?`,
      {
        default: true,
      }
    );
    if (!confirmed) {
      console.log(info('Cancelled'));
      process.exit(0);
    }
  }

  const result = importApiProfileBundle(bundle, {
    name: nameExtracted.value,
    target: targetParsed.target,
    force,
  });

  if (!result.success) {
    console.log(fail(result.error || 'Failed to import profile'));
    if (result.validation?.issues?.length) {
      console.log('');
      result.validation.issues.forEach((issue) => {
        const indicator = issue.level === 'error' ? color('[X]', 'error') : color('[!]', 'warning');
        console.log(`${indicator} ${issue.message}`);
      });
    }
    process.exit(1);
  }

  console.log(ok(`Profile imported: ${result.name}`));
  if (result.warnings && result.warnings.length > 0) {
    result.warnings.forEach((warningMessage) => console.log(warn(warningMessage)));
  }
  console.log('');
}

/** Show help for api commands */
async function showHelp(): Promise<void> {
  await initUI();
  const presetIds = getPresetIds()
    .map((id) => sanitizeHelpText(id))
    .filter(Boolean);
  const presetAliases = getPresetAliases();
  const presetIdWidth = Math.max(0, ...presetIds.map((id) => id.length)) + 2;

  console.log(header('CCS API Management'));
  console.log('');
  console.log(subheader('Usage'));
  console.log(`  ${color('ccs api', 'command')} <command> [options]`);
  console.log('');
  console.log(subheader('Commands'));
  console.log(`  ${color('create [name]', 'command')}    Create new API profile (interactive)`);
  console.log(`  ${color('list', 'command')}             List all API profiles`);
  console.log(
    `  ${color('discover', 'command')}         Discover orphan *.settings.json and register`
  );
  console.log(`  ${color('copy <src> <dest>', 'command')} Duplicate API profile settings + config`);
  console.log(
    `  ${color('export <name>', 'command')}    Export profile bundle for cross-device transfer`
  );
  console.log(
    `  ${color('import <file>', 'command')}    Import profile bundle and register profile`
  );
  console.log(`  ${color('remove <name>', 'command')}    Remove an API profile`);
  console.log('');
  console.log(subheader('Options'));
  console.log(
    `  ${color('--preset <id>', 'command')}        Use provider preset (${presetIds.join(', ')})`
  );
  console.log(`  ${color('--base-url <url>', 'command')}     API base URL (create)`);
  console.log(`  ${color('--api-key <key>', 'command')}      API key (create)`);
  console.log(`  ${color('--model <model>', 'command')}      Default model (create)`);
  console.log(
    `  ${color('--target <cli>', 'command')}       Default target: claude or droid (create)`
  );
  console.log(`  ${color('--register', 'command')}           Register discovered orphan settings`);
  console.log(`  ${color('--json', 'command')}               JSON output for discover command`);
  console.log(`  ${color('--out <file>', 'command')}         Export bundle output path`);
  console.log(`  ${color('--include-secrets', 'command')}    Include token in export bundle`);
  console.log(`  ${color('--name <name>', 'command')}        Override profile name during import`);
  console.log(
    `  ${color('--force', 'command')}              Overwrite existing or bypass validation (create/discover/copy/import)`
  );
  console.log(`  ${color('--yes, -y', 'command')}            Skip confirmation prompts`);
  console.log('');
  console.log(subheader('Provider Presets'));
  PROVIDER_PRESETS.forEach((preset) => console.log(renderPresetHelpLine(preset, presetIdWidth)));
  Object.entries(presetAliases).forEach(([alias, canonical]) => {
    const safeAlias = sanitizeHelpText(alias);
    const safeCanonical = sanitizeHelpText(canonical);
    console.log(
      `  ${dim(`Legacy alias: --preset ${safeAlias} (auto-mapped to ${safeCanonical})`)}`
    );
  });
  console.log('');
  console.log(subheader('Examples'));
  console.log(`  ${dim('# Interactive wizard')}`);
  console.log(`  ${color('ccs api create', 'command')}`);
  console.log('');
  console.log(`  ${dim('# Quick setup with preset')}`);
  console.log(`  ${color('ccs api create --preset anthropic', 'command')}`);
  console.log(`  ${color('ccs api create --preset openrouter', 'command')}`);
  console.log(`  ${color('ccs api create --preset alibaba-coding-plan', 'command')}`);
  console.log(`  ${color('ccs api create --preset alibaba', 'command')} ${dim('# alias')}`);
  console.log(`  ${color('ccs api create --preset glm', 'command')}`);
  console.log('');
  console.log(`  ${dim('# Create with name')}`);
  console.log(`  ${color('ccs api create myapi', 'command')}`);
  console.log(`  ${color('ccs api create mydroid --preset glm --target droid', 'command')}`);
  console.log('');
  console.log(`  ${dim('# Remove API profile')}`);
  console.log(`  ${color('ccs api remove myapi', 'command')}`);
  console.log('');
  console.log(`  ${dim('# Discover and register orphan settings files')}`);
  console.log(`  ${color('ccs api discover', 'command')}`);
  console.log(`  ${color('ccs api discover --register', 'command')}`);
  console.log('');
  console.log(`  ${dim('# Duplicate an existing API profile')}`);
  console.log(`  ${color('ccs api copy glm glm-backup', 'command')}`);
  console.log('');
  console.log(`  ${dim('# Export and import across devices')}`);
  console.log(`  ${color('ccs api export glm --out ./glm.ccs-profile.json', 'command')}`);
  console.log(`  ${color('ccs api import ./glm.ccs-profile.json', 'command')}`);
  console.log('');
  console.log(`  ${dim('# Show all API profiles')}`);
  console.log(`  ${color('ccs api list', 'command')}`);
  console.log('');
}

/** Main api command router */
export async function handleApiCommand(args: string[]): Promise<void> {
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    await showHelp();
    return;
  }

  switch (command) {
    case 'create':
      await handleCreate(args.slice(1));
      break;
    case 'list':
      await handleList();
      break;
    case 'discover':
      await handleDiscover(args.slice(1));
      break;
    case 'copy':
      await handleCopy(args.slice(1));
      break;
    case 'export':
      await handleExport(args.slice(1));
      break;
    case 'import':
      await handleImport(args.slice(1));
      break;
    case 'remove':
    case 'delete':
    case 'rm':
      await handleRemove(args.slice(1));
      break;
    default:
      await initUI();
      console.log(fail(`Unknown command: ${command}`));
      console.log('');
      console.log('Run for help:');
      console.log(`  ${color('ccs api --help', 'command')}`);
      process.exit(1);
  }
}
