/**
 * Config Image Analysis Command Handler
 *
 * Manages image_analysis section of config.yaml via CLI.
 * Usage: ccs config image-analysis [options]
 */

import { initUI, header, ok, info, warn, fail, subheader, color, dim } from '../utils/ui';
import {
  getImageAnalysisConfig,
  updateUnifiedConfig,
  loadOrCreateUnifiedConfig,
} from '../config/unified-config-loader';
import { DEFAULT_IMAGE_ANALYSIS_CONFIG } from '../config/unified-config-types';
import {
  CLIPROXY_PROVIDER_IDS,
  PROVIDER_CAPABILITIES,
  mapExternalProviderName,
} from '../cliproxy/provider-capabilities';
import { extractOption, hasAnyFlag } from './arg-extractor';
import { normalizeImageAnalysisBackendId } from '../utils/hooks';

interface ImageAnalysisCommandOptions {
  enable?: boolean;
  disable?: boolean;
  timeout?: number;
  setModel?: { provider: string; model: string };
  setFallback?: string;
  setProfileBackend?: { profile: string; backend: string };
  clearProfileBackend?: string;
  setModelError?: string;
  setFallbackError?: string;
  setProfileBackendError?: string;
  help?: boolean;
}

const IMAGE_ANALYSIS_PROVIDER_ALIASES = Object.freeze(
  CLIPROXY_PROVIDER_IDS.flatMap((provider) => PROVIDER_CAPABILITIES[provider].aliases).filter(
    (alias, index, aliases) => aliases.indexOf(alias) === index
  )
);

function isConfiguredImageAnalysisBackend(
  backend: string | null,
  providerModels: Record<string, string>
): backend is string {
  return Boolean(backend && Object.prototype.hasOwnProperty.call(providerModels, backend));
}

function parseArgs(args: string[]): ImageAnalysisCommandOptions {
  const options: ImageAnalysisCommandOptions = {
    enable: hasAnyFlag(args, ['--enable']),
    disable: hasAnyFlag(args, ['--disable']),
    help: hasAnyFlag(args, ['--help', '-h']),
  };

  const timeoutOption = extractOption(args, ['--timeout']);
  if (timeoutOption.found) {
    const timeout = parseInt(timeoutOption.value || '', 10);
    if (isNaN(timeout) || timeout < 10 || timeout > 600) {
      console.error(fail('Timeout must be between 10 and 600 seconds'));
      process.exit(1);
    }
    options.timeout = timeout;
  }

  const setModelIdx = args.indexOf('--set-model');
  if (setModelIdx !== -1) {
    const provider = args[setModelIdx + 1];
    const model = args[setModelIdx + 2];
    if (provider && model && !provider.startsWith('-') && !model.startsWith('-')) {
      options.setModel = { provider, model };
    } else {
      options.setModelError = '--set-model requires <provider> <model>';
    }
  }

  const setFallbackIdx = args.indexOf('--set-fallback');
  if (setFallbackIdx !== -1) {
    const backend = args[setFallbackIdx + 1];
    if (backend && !backend.startsWith('-')) {
      options.setFallback = backend;
    } else {
      options.setFallbackError = '--set-fallback requires <backend>';
    }
  }

  const setProfileBackendIdx = args.indexOf('--set-profile-backend');
  if (setProfileBackendIdx !== -1) {
    const profile = args[setProfileBackendIdx + 1];
    const backend = args[setProfileBackendIdx + 2];
    if (profile && backend && !profile.startsWith('-') && !backend.startsWith('-')) {
      options.setProfileBackend = { profile, backend };
    } else {
      options.setProfileBackendError = '--set-profile-backend requires <profile> <backend>';
    }
  }

  const clearProfileBackend = extractOption(args, ['--clear-profile-backend']);
  if (clearProfileBackend.found) {
    if (clearProfileBackend.value && !clearProfileBackend.value.startsWith('-')) {
      options.clearProfileBackend = clearProfileBackend.value;
    } else {
      options.setProfileBackendError = '--clear-profile-backend requires <profile>';
    }
  }

  return options;
}

function showHelp(): void {
  console.log('');
  console.log(header('ccs config image-analysis'));
  console.log('');
  console.log('  Configure image analysis for CLIProxy providers.');
  console.log('  Images/PDFs are analyzed via vision models instead of direct Read.');
  console.log('');

  console.log(subheader('Usage:'));
  console.log(`  ${color('ccs config image-analysis', 'command')} [options]`);
  console.log('');

  console.log(subheader('Options:'));
  console.log(`  ${color('--enable', 'command')}                  Enable image analysis`);
  console.log(`  ${color('--disable', 'command')}                 Disable image analysis`);
  console.log(`  ${color('--timeout <seconds>', 'command')}       Set analysis timeout (10-600)`);
  console.log(`  ${color('--set-model <p> <m>', 'command')}       Set model for provider`);
  console.log(`  ${color('--set-fallback <backend>', 'command')}  Set fallback backend`);
  console.log(
    `  ${color('--set-profile-backend <p> <b>', 'command')} Map a profile alias to a backend`
  );
  console.log(
    `  ${color('--clear-profile-backend <p>', 'command')}   Remove a saved profile mapping`
  );
  console.log(`  ${color('--help, -h', 'command')}                Show this help`);
  console.log('');

  console.log(subheader('Provider Models:'));
  console.log(`  ${dim(`Valid providers: ${CLIPROXY_PROVIDER_IDS.join(', ')}`)}`);
  if (IMAGE_ANALYSIS_PROVIDER_ALIASES.length > 0) {
    console.log(`  ${dim(`Aliases accepted: ${IMAGE_ANALYSIS_PROVIDER_ALIASES.join(', ')}`)}`);
  }
  console.log(
    `  ${dim('Defaults: agy -> gemini-3-1-flash-preview, gemini -> gemini-3-flash-preview')}`
  );
  console.log('');

  console.log(subheader('Examples:'));
  console.log(
    `  $ ${color('ccs config image-analysis', 'command')}               ${dim('# Show status')}`
  );
  console.log(
    `  $ ${color('ccs config image-analysis --enable', 'command')}      ${dim('# Enable feature')}`
  );
  console.log(
    `  $ ${color('ccs config image-analysis --timeout 120', 'command')} ${dim('# Set 2min timeout')}`
  );
  console.log(
    `  $ ${color('ccs config image-analysis --set-model agy gemini-2.5-pro', 'command')}`
  );
  console.log('');

  console.log(subheader('How it works:'));
  console.log(`  1. When Claude's Read tool targets an image/PDF file`);
  console.log(`  2. CCS hook intercepts and sends to CLIProxy vision API`);
  console.log(`  3. Vision model analyzes and returns text description`);
  console.log(`  4. Claude receives description instead of raw image data`);
  console.log('');

  console.log(subheader('Supported file types:'));
  console.log(`  ${dim('Images: .jpg, .jpeg, .png, .gif, .webp, .heic, .bmp, .tiff')}`);
  console.log(`  ${dim('Documents: .pdf')}`);
  console.log('');
}

function showStatus(): void {
  const config = getImageAnalysisConfig();

  console.log('');
  console.log(header('Image Analysis Configuration'));
  console.log('');

  // Status
  const statusText = config.enabled ? ok('Enabled') : warn('Disabled');
  console.log(`  Status:   ${statusText}`);
  console.log(`  Timeout:  ${config.timeout}s`);
  console.log('');

  // Provider models
  console.log(subheader('Provider Models:'));
  const providers = Object.entries(config.provider_models);
  if (providers.length === 0) {
    console.log(`  ${dim('No providers configured')}`);
  } else {
    for (const [provider, model] of providers) {
      const isDefault =
        DEFAULT_IMAGE_ANALYSIS_CONFIG.provider_models[
          provider as keyof typeof DEFAULT_IMAGE_ANALYSIS_CONFIG.provider_models
        ] === model;
      const suffix = isDefault ? dim(' (default)') : '';
      // Edge case #3: Long model name truncation
      const truncatedModel = model.length > 40 ? model.slice(0, 37) + '...' : model;
      console.log(`  ${color(provider.padEnd(10), 'command')} ${truncatedModel}${suffix}`);
    }
  }
  console.log('');

  // Config location
  console.log(subheader('Configuration:'));
  console.log(`  File: ${color('~/.ccs/config.yaml', 'path')}`);
  console.log(`  Section: ${dim('image_analysis')}`);
  console.log(`  Fallback backend: ${color(config.fallback_backend || 'none', 'command')}`);
  const profileBackends = Object.entries(config.profile_backends ?? {});
  if (profileBackends.length > 0) {
    console.log('');
    console.log(subheader('Profile Backends:'));
    for (const [profile, backend] of profileBackends) {
      console.log(`  ${color(profile.padEnd(16), 'command')} ${backend}`);
    }
  }
  console.log('');

  // Troubleshooting hint if disabled
  if (!config.enabled) {
    console.log(info('To enable: ccs config image-analysis --enable'));
    console.log('');
  }
}

export async function handleConfigImageAnalysisCommand(args: string[]): Promise<void> {
  await initUI();

  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  if (options.setModelError) {
    console.error(fail(options.setModelError));
    process.exit(1);
  }

  if (options.setFallbackError) {
    console.error(fail(options.setFallbackError));
    process.exit(1);
  }

  if (options.setProfileBackendError) {
    console.error(fail(options.setProfileBackendError));
    process.exit(1);
  }

  // Validate conflicting flags (Edge case #2: --enable + --disable conflict)
  if (options.enable && options.disable) {
    console.error(fail('Cannot use --enable and --disable together'));
    process.exit(1);
  }

  // Apply changes if any options provided
  let hasChanges = false;
  const config = loadOrCreateUnifiedConfig();
  const imageConfig = config.image_analysis ?? { ...DEFAULT_IMAGE_ANALYSIS_CONFIG };

  if (options.enable) {
    imageConfig.enabled = true;
    hasChanges = true;
  }

  if (options.disable) {
    imageConfig.enabled = false;
    hasChanges = true;
  }

  if (options.timeout !== undefined) {
    imageConfig.timeout = options.timeout;
    hasChanges = true;
  }

  if (options.setModel) {
    const validProviders = [...CLIPROXY_PROVIDER_IDS];
    const normalizedProviderInput = options.setModel.provider.trim().toLowerCase();
    const canonicalProvider = mapExternalProviderName(normalizedProviderInput);
    if (!canonicalProvider) {
      console.error(fail(`Invalid provider: ${options.setModel.provider}`));
      console.error(info(`Valid providers: ${validProviders.join(', ')}`));
      process.exit(1);
    }
    // Validate model name (Edge case #1: Empty model string validation)
    const model = options.setModel.model;
    if (!model || model.trim() === '') {
      console.error(fail('Model name cannot be empty'));
      process.exit(1);
    }
    imageConfig.provider_models = {
      ...imageConfig.provider_models,
      [canonicalProvider]: model,
    };
    hasChanges = true;
  }

  if (options.setFallback) {
    const normalizedBackend = normalizeImageAnalysisBackendId(
      options.setFallback,
      Object.keys(imageConfig.provider_models)
    );
    if (!isConfiguredImageAnalysisBackend(normalizedBackend, imageConfig.provider_models)) {
      console.error(fail(`Invalid fallback backend: ${options.setFallback}`));
      process.exit(1);
    }
    imageConfig.fallback_backend = normalizedBackend;
    hasChanges = true;
  }

  if (options.setProfileBackend) {
    const profileName = options.setProfileBackend.profile.trim();
    const normalizedBackend = normalizeImageAnalysisBackendId(
      options.setProfileBackend.backend,
      Object.keys(imageConfig.provider_models)
    );
    if (!profileName) {
      console.error(fail('Profile name cannot be empty'));
      process.exit(1);
    }
    if (!isConfiguredImageAnalysisBackend(normalizedBackend, imageConfig.provider_models)) {
      console.error(fail(`Invalid backend: ${options.setProfileBackend.backend}`));
      process.exit(1);
    }
    imageConfig.profile_backends = {
      ...(imageConfig.profile_backends ?? {}),
      [profileName]: normalizedBackend,
    };
    hasChanges = true;
  }

  if (options.clearProfileBackend) {
    const profileName = options.clearProfileBackend.trim().toLowerCase();
    const nextProfileBackends = Object.fromEntries(
      Object.entries(imageConfig.profile_backends ?? {}).filter(
        ([name]) => name.trim().toLowerCase() !== profileName
      )
    );
    imageConfig.profile_backends = nextProfileBackends;
    hasChanges = true;
  }

  if (hasChanges) {
    updateUnifiedConfig({ image_analysis: imageConfig });
    console.log(ok('Configuration updated'));
    console.log('');
  }

  // Always show current status
  showStatus();
}
