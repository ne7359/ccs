import type { CLIProxyProvider } from './types';

export type OAuthFlowType = 'authorization_code' | 'device_code';

export interface ProviderFeatureFlags {
  supportsQuota: boolean;
  requiresNickname: boolean;
  supportsImageAnalysis: boolean;
}

export interface ProviderDefaults {
  imageAnalysisModel: string | null;
}

export interface ProviderCapabilities {
  displayName: string;
  oauthFlow: OAuthFlowType;
  callbackPort: number | null;
  /**
   * Alternative provider names used by CLIProxyAPI or stats endpoints.
   * These aliases normalize external names to canonical CCS provider IDs.
   */
  aliases: readonly string[];
  /**
   * UI-safe logo asset path for provider branding.
   */
  logoAssetPath: string | null;
  /**
   * Provider feature flags consumed by CLI/UI adapters.
   */
  features: ProviderFeatureFlags;
  /**
   * Provider defaults used by config commands and migration-safe accessors.
   */
  defaults: ProviderDefaults;
}

interface ProviderCapabilitiesInput {
  displayName: string;
  oauthFlow: OAuthFlowType;
  callbackPort: number | null;
  aliases?: readonly string[];
  logoAssetPath?: string | null;
  features?: Partial<ProviderFeatureFlags>;
  defaults?: Partial<ProviderDefaults>;
}

const DEFAULT_PROVIDER_FEATURES: ProviderFeatureFlags = {
  supportsQuota: false,
  requiresNickname: false,
  supportsImageAnalysis: true,
};

const DEFAULT_PROVIDER_DEFAULTS: ProviderDefaults = {
  imageAnalysisModel: null,
};

function defineProviderCapabilities(input: ProviderCapabilitiesInput): ProviderCapabilities {
  return {
    displayName: input.displayName,
    oauthFlow: input.oauthFlow,
    callbackPort: input.callbackPort,
    aliases: input.aliases ?? [],
    logoAssetPath: input.logoAssetPath ?? null,
    features: {
      ...DEFAULT_PROVIDER_FEATURES,
      ...input.features,
    },
    defaults: {
      ...DEFAULT_PROVIDER_DEFAULTS,
      ...input.defaults,
    },
  };
}

export const PROVIDER_CAPABILITIES: Record<CLIProxyProvider, ProviderCapabilities> = {
  gemini: defineProviderCapabilities({
    displayName: 'Google Gemini',
    oauthFlow: 'authorization_code',
    callbackPort: 8085,
    aliases: ['gemini-cli'],
    logoAssetPath: '/assets/providers/gemini-color.svg',
    defaults: { imageAnalysisModel: 'gemini-2.5-flash' },
  }),
  codex: defineProviderCapabilities({
    displayName: 'Codex',
    oauthFlow: 'authorization_code',
    callbackPort: 1455,
    logoAssetPath: '/assets/providers/openai.svg',
    defaults: { imageAnalysisModel: 'gpt-5.1-codex-mini' },
  }),
  agy: defineProviderCapabilities({
    displayName: 'AntiGravity',
    oauthFlow: 'authorization_code',
    callbackPort: 51121,
    aliases: ['antigravity'],
    logoAssetPath: '/assets/providers/agy.png',
    features: { supportsQuota: true },
    defaults: { imageAnalysisModel: 'gemini-2.5-flash' },
  }),
  qwen: defineProviderCapabilities({
    displayName: 'Qwen',
    oauthFlow: 'device_code',
    callbackPort: null,
    logoAssetPath: '/assets/providers/qwen-color.svg',
    defaults: { imageAnalysisModel: 'vision-model' },
  }),
  iflow: defineProviderCapabilities({
    displayName: 'iFlow',
    oauthFlow: 'authorization_code',
    callbackPort: 11451,
    logoAssetPath: '/assets/providers/iflow.png',
    defaults: { imageAnalysisModel: 'qwen3-vl-plus' },
  }),
  kiro: defineProviderCapabilities({
    displayName: 'Kiro (AWS)',
    oauthFlow: 'device_code',
    callbackPort: null,
    aliases: ['codewhisperer'],
    logoAssetPath: '/assets/providers/kiro.png',
    features: { requiresNickname: true },
    defaults: { imageAnalysisModel: 'kiro-claude-haiku-4-5' },
  }),
  ghcp: defineProviderCapabilities({
    displayName: 'GitHub Copilot (OAuth)',
    oauthFlow: 'device_code',
    callbackPort: null,
    aliases: ['github-copilot', 'copilot'],
    logoAssetPath: '/assets/providers/copilot.svg',
    features: { requiresNickname: true },
    defaults: { imageAnalysisModel: 'claude-haiku-4.5' },
  }),
  claude: defineProviderCapabilities({
    displayName: 'Claude',
    oauthFlow: 'authorization_code',
    callbackPort: 54545,
    aliases: ['anthropic'],
    logoAssetPath: '/assets/providers/claude.svg',
    defaults: { imageAnalysisModel: 'claude-haiku-4-5-20251001' },
  }),
};

export const CLIPROXY_PROVIDER_IDS = Object.freeze(
  Object.keys(PROVIDER_CAPABILITIES) as CLIProxyProvider[]
);

const PROVIDER_ID_SET = new Set(CLIPROXY_PROVIDER_IDS);

const PROVIDER_ALIAS_MAP: ReadonlyMap<string, CLIProxyProvider> = (() => {
  const entries: Array<[string, CLIProxyProvider]> = [];
  for (const provider of CLIPROXY_PROVIDER_IDS) {
    entries.push([provider.toLowerCase(), provider]);
    for (const alias of PROVIDER_CAPABILITIES[provider].aliases) {
      entries.push([alias.toLowerCase(), provider]);
    }
  }
  return new Map(entries);
})();

export function isCLIProxyProvider(provider: string): provider is CLIProxyProvider {
  return PROVIDER_ID_SET.has(provider as CLIProxyProvider);
}

export function getProviderCapabilities(provider: CLIProxyProvider): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[provider];
}

export function getProviderDisplayName(provider: CLIProxyProvider): string {
  return PROVIDER_CAPABILITIES[provider].displayName;
}

export function getProviderAliases(provider: CLIProxyProvider): readonly string[] {
  return PROVIDER_CAPABILITIES[provider].aliases;
}

export function getProviderDefaultImageAnalysisModel(provider: CLIProxyProvider): string | null {
  return PROVIDER_CAPABILITIES[provider].defaults.imageAnalysisModel;
}

export function getProviderLogoAssetPath(provider: CLIProxyProvider): string | null {
  return PROVIDER_CAPABILITIES[provider].logoAssetPath;
}

export function providerRequiresNickname(provider: CLIProxyProvider): boolean {
  return PROVIDER_CAPABILITIES[provider].features.requiresNickname;
}

export function supportsProviderQuota(provider: CLIProxyProvider): boolean {
  return PROVIDER_CAPABILITIES[provider].features.supportsQuota;
}

export function supportsProviderImageAnalysis(provider: CLIProxyProvider): boolean {
  return PROVIDER_CAPABILITIES[provider].features.supportsImageAnalysis;
}

export function getProvidersByOAuthFlow(flowType: OAuthFlowType): CLIProxyProvider[] {
  return CLIPROXY_PROVIDER_IDS.filter(
    (provider) => PROVIDER_CAPABILITIES[provider].oauthFlow === flowType
  );
}

export const DEVICE_CODE_PROVIDER_IDS = Object.freeze(getProvidersByOAuthFlow('device_code'));

export const NICKNAME_REQUIRED_PROVIDER_IDS = Object.freeze(
  CLIPROXY_PROVIDER_IDS.filter(providerRequiresNickname)
);

export const IMAGE_ANALYSIS_PROVIDER_IDS = Object.freeze(
  CLIPROXY_PROVIDER_IDS.filter(supportsProviderImageAnalysis)
);

export function getProvidersSupportingImageAnalysis(): CLIProxyProvider[] {
  return [...IMAGE_ANALYSIS_PROVIDER_IDS];
}

export function getOAuthFlowType(provider: CLIProxyProvider): OAuthFlowType {
  return PROVIDER_CAPABILITIES[provider].oauthFlow;
}

export function getOAuthCallbackPort(provider: CLIProxyProvider): number | null {
  return PROVIDER_CAPABILITIES[provider].callbackPort;
}

export function mapExternalProviderName(providerName: string): CLIProxyProvider | null {
  const normalized = providerName.toLowerCase();
  return PROVIDER_ALIAS_MAP.get(normalized) ?? null;
}
