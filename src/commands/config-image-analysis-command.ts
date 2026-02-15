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
  getProvidersSupportingImageAnalysis,
  mapExternalProviderName,
} from '../cliproxy/provider-capabilities';

interface ImageAnalysisCommandOptions {
  enable?: boolean;
  disable?: boolean;
  timeout?: number;
  setModel?: { provider: string; model: string };
  help?: boolean;
}

function parseArgs(args: string[]): ImageAnalysisCommandOptions {
  const options: ImageAnalysisCommandOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--enable') {
      options.enable = true;
    } else if (arg === '--disable') {
      options.disable = true;
    } else if (arg === '--timeout' && args[i + 1]) {
      const timeout = parseInt(args[++i], 10);
      if (isNaN(timeout) || timeout < 10 || timeout > 600) {
        console.error(fail('Timeout must be between 10 and 600 seconds'));
        process.exit(1);
      }
      options.timeout = timeout;
    } else if (arg === '--set-model' && args[i + 1] && args[i + 2]) {
      options.setModel = {
        provider: args[++i],
        model: args[++i],
      };
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function showHelp(): void {
  const providersWithVisionSupport = getProvidersSupportingImageAnalysis().join(', ');

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
  console.log(`  ${color('--help, -h', 'command')}                Show this help`);
  console.log('');

  console.log(subheader('Provider Models:'));
  console.log(`  ${dim(`Providers with vision support: ${providersWithVisionSupport}`)}`);
  console.log(`  ${dim('Default model: gemini-2.5-flash (most providers)')}`);
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
  const validProviders = getProvidersSupportingImageAnalysis();
  const validProviderSet = new Set(validProviders);

  if (options.help) {
    showHelp();
    return;
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
    const canonicalProvider = mapExternalProviderName(options.setModel.provider);
    if (!canonicalProvider || !validProviderSet.has(canonicalProvider)) {
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

  if (hasChanges) {
    updateUnifiedConfig({ image_analysis: imageConfig });
    console.log(ok('Configuration updated'));
    console.log('');
  }

  // Always show current status
  showStatus();
}
