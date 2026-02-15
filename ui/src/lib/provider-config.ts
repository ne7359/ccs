/**
 * Provider Configuration
 * Shared constants for CLIProxy providers - SINGLE SOURCE OF TRUTH for UI
 *
 * When adding a new provider, update CLIPROXY_PROVIDERS and PROVIDER_METADATA.
 */

/**
 * Canonical list of CLIProxy provider IDs
 * This is the UI's single source of truth for valid providers.
 * Must stay in sync with backend's CLIPROXY_PROFILES in src/auth/profile-detector.ts
 */
export const CLIPROXY_PROVIDERS = [
  'gemini',
  'codex',
  'agy',
  'qwen',
  'iflow',
  'kiro',
  'ghcp',
  'claude',
] as const;

/** Union type for CLIProxy provider IDs */
export type CLIProxyProvider = (typeof CLIPROXY_PROVIDERS)[number];
export type ProviderOAuthFlowType = 'authorization_code' | 'device_code';

interface ProviderMetadata {
  displayName: string;
  setupName: string;
  setupDescription: string;
  deviceCodeDisplayName: string;
  color: string;
  assetPath: string | null;
  oauthFlow: ProviderOAuthFlowType;
  nicknameRequired: boolean;
  logoFallbackTextClass: string;
  logoFallbackLetter: string;
  wizardOrder: number;
}

const PROVIDER_METADATA: Record<CLIProxyProvider, ProviderMetadata> = {
  gemini: {
    displayName: 'Gemini',
    setupName: 'Google Gemini',
    setupDescription: 'Gemini Pro/Flash models',
    deviceCodeDisplayName: 'Gemini',
    color: '#4285F4',
    assetPath: '/assets/providers/gemini-color.svg',
    oauthFlow: 'authorization_code',
    nicknameRequired: false,
    logoFallbackTextClass: 'text-blue-600',
    logoFallbackLetter: 'G',
    wizardOrder: 3,
  },
  codex: {
    displayName: 'Codex',
    setupName: 'OpenAI Codex',
    setupDescription: 'GPT-4 and codex models',
    deviceCodeDisplayName: 'Codex',
    color: '#10a37f',
    assetPath: '/assets/providers/openai.svg',
    oauthFlow: 'authorization_code',
    nicknameRequired: false,
    logoFallbackTextClass: 'text-emerald-600',
    logoFallbackLetter: 'X',
    wizardOrder: 4,
  },
  agy: {
    displayName: 'Antigravity',
    setupName: 'Antigravity',
    setupDescription: 'Antigravity AI models',
    deviceCodeDisplayName: 'Antigravity',
    color: '#f3722c',
    assetPath: '/assets/providers/agy.png',
    oauthFlow: 'authorization_code',
    nicknameRequired: false,
    logoFallbackTextClass: 'text-violet-600',
    logoFallbackLetter: 'A',
    wizardOrder: 1,
  },
  qwen: {
    displayName: 'Qwen',
    setupName: 'Alibaba Qwen',
    setupDescription: 'Qwen Code models',
    deviceCodeDisplayName: 'Qwen Code',
    color: '#6236FF',
    assetPath: '/assets/providers/qwen-color.svg',
    oauthFlow: 'device_code',
    nicknameRequired: false,
    logoFallbackTextClass: 'text-cyan-600',
    logoFallbackLetter: 'Q',
    wizardOrder: 5,
  },
  iflow: {
    displayName: 'iFlow',
    setupName: 'iFlow',
    setupDescription: 'iFlow AI models',
    deviceCodeDisplayName: 'iFlow',
    color: '#f94144',
    assetPath: '/assets/providers/iflow.png',
    oauthFlow: 'authorization_code',
    nicknameRequired: false,
    logoFallbackTextClass: 'text-indigo-600',
    logoFallbackLetter: 'i',
    wizardOrder: 6,
  },
  kiro: {
    displayName: 'Kiro (AWS)',
    setupName: 'Kiro (AWS)',
    setupDescription: 'AWS CodeWhisperer models',
    deviceCodeDisplayName: 'Kiro (AWS)',
    color: '#4d908e',
    assetPath: '/assets/providers/kiro.png',
    oauthFlow: 'device_code',
    nicknameRequired: true,
    logoFallbackTextClass: 'text-teal-600',
    logoFallbackLetter: 'K',
    wizardOrder: 7,
  },
  ghcp: {
    displayName: 'GitHub Copilot (OAuth)',
    setupName: 'GitHub Copilot (OAuth)',
    setupDescription: 'GitHub Copilot via OAuth',
    deviceCodeDisplayName: 'GitHub Copilot',
    color: '#43aa8b',
    assetPath: '/assets/providers/copilot.svg',
    oauthFlow: 'device_code',
    nicknameRequired: true,
    logoFallbackTextClass: 'text-green-600',
    logoFallbackLetter: 'C',
    wizardOrder: 8,
  },
  claude: {
    displayName: 'Claude (Anthropic)',
    setupName: 'Claude (Anthropic)',
    setupDescription: 'Claude Opus/Sonnet models',
    deviceCodeDisplayName: 'Claude',
    color: '#D97757',
    assetPath: '/assets/providers/claude.svg',
    oauthFlow: 'authorization_code',
    nicknameRequired: false,
    logoFallbackTextClass: 'text-orange-600',
    logoFallbackLetter: 'C',
    wizardOrder: 2,
  },
};

const LEGACY_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  vertex: 'Vertex AI',
};

const LEGACY_PROVIDER_COLORS: Record<string, string> = {
  vertex: '#4285F4',
};

function getCanonicalProvider(provider: string): CLIProxyProvider | null {
  const normalized = provider.trim().toLowerCase();
  if (CLIPROXY_PROVIDERS.includes(normalized as CLIProxyProvider)) {
    return normalized as CLIProxyProvider;
  }
  return null;
}

/** Check if a string is a valid CLIProxy provider */
export function isValidProvider(provider: string): provider is CLIProxyProvider {
  return CLIPROXY_PROVIDERS.includes(provider as CLIProxyProvider);
}

export function getProviderMetadata(provider: string): ProviderMetadata | null {
  const canonicalProvider = getCanonicalProvider(provider);
  if (!canonicalProvider) return null;
  return PROVIDER_METADATA[canonicalProvider];
}

// Map provider names to asset filenames (only providers with actual logos)
export const PROVIDER_ASSETS: Record<string, string> = CLIPROXY_PROVIDERS.reduce(
  (assets, provider) => {
    const assetPath = PROVIDER_METADATA[provider].assetPath;
    if (assetPath) {
      assets[provider] = assetPath;
    }
    return assets;
  },
  {} as Record<string, string>
);

// Provider brand colors
export const PROVIDER_COLORS: Record<string, string> = {
  ...CLIPROXY_PROVIDERS.reduce(
    (colors, provider) => {
      colors[provider] = PROVIDER_METADATA[provider].color;
      return colors;
    },
    {} as Record<string, string>
  ),
  ...LEGACY_PROVIDER_COLORS,
};

// Map provider to display name
export function getProviderDisplayName(provider: string): string {
  const metadata = getProviderMetadata(provider);
  if (metadata) return metadata.displayName;
  return LEGACY_PROVIDER_DISPLAY_NAMES[provider.toLowerCase()] || provider;
}

export function getProviderDeviceCodeDisplayName(provider: string): string {
  const metadata = getProviderMetadata(provider);
  if (metadata) return metadata.deviceCodeDisplayName;
  return getProviderDisplayName(provider);
}

export function getProviderSetupInfo(provider: CLIProxyProvider): {
  name: string;
  description: string;
} {
  const metadata = PROVIDER_METADATA[provider];
  return {
    name: metadata.setupName,
    description: metadata.setupDescription,
  };
}

export function getProviderLogoMetadata(provider: string): {
  assetPath: string | null;
  textClass: string;
  letter: string;
} {
  const metadata = getProviderMetadata(provider);
  if (metadata) {
    return {
      assetPath: metadata.assetPath,
      textClass: metadata.logoFallbackTextClass,
      letter: metadata.logoFallbackLetter,
    };
  }
  return {
    assetPath: null,
    textClass: 'text-gray-600',
    letter: provider[0]?.toUpperCase() || '?',
  };
}

/**
 * Providers that use Device Code OAuth flow instead of Authorization Code flow.
 * Device Code flow requires displaying a user code for manual entry at provider's website.
 */
export const DEVICE_CODE_PROVIDERS: CLIProxyProvider[] = CLIPROXY_PROVIDERS.filter(
  (provider) => PROVIDER_METADATA[provider].oauthFlow === 'device_code'
);

export const WIZARD_PROVIDER_ORDER: CLIProxyProvider[] = [...CLIPROXY_PROVIDERS].sort(
  (left, right) => PROVIDER_METADATA[left].wizardOrder - PROVIDER_METADATA[right].wizardOrder
);

/** Check if provider uses Device Code flow */
export function isDeviceCodeProvider(provider: string): boolean {
  const metadata = getProviderMetadata(provider);
  return metadata?.oauthFlow === 'device_code';
}

/** Providers that require nickname because token payload may not include email. */
export const NICKNAME_REQUIRED_PROVIDERS: CLIProxyProvider[] = CLIPROXY_PROVIDERS.filter(
  (provider) => PROVIDER_METADATA[provider].nicknameRequired
);

/** Check if provider requires user-supplied nickname in auth flow */
export function isNicknameRequiredProvider(provider: string): boolean {
  const metadata = getProviderMetadata(provider);
  return metadata?.nicknameRequired ?? false;
}

/** Kiro auth methods exposed in CCS UI (aligned with CLIProxyAPIPlus support). */
export const KIRO_AUTH_METHODS = ['aws', 'aws-authcode', 'google', 'github'] as const;
export type KiroAuthMethod = (typeof KIRO_AUTH_METHODS)[number];

export type KiroFlowType = 'authorization_code' | 'device_code';
export type KiroStartEndpoint = 'start' | 'start-url';

export interface KiroAuthMethodOption {
  id: KiroAuthMethod;
  label: string;
  description: string;
  flowType: KiroFlowType;
  startEndpoint: KiroStartEndpoint;
}

/** UX-first default for issue #233: AWS Builder ID device flow. */
export const DEFAULT_KIRO_AUTH_METHOD: KiroAuthMethod = 'aws';

export const KIRO_AUTH_METHOD_OPTIONS: readonly KiroAuthMethodOption[] = [
  {
    id: 'aws',
    label: 'AWS Builder ID (Recommended)',
    description: 'Device code flow for AWS organizations and Builder ID accounts.',
    flowType: 'device_code',
    startEndpoint: 'start',
  },
  {
    id: 'aws-authcode',
    label: 'AWS Builder ID (Auth Code)',
    description: 'Authorization code flow via CLI binary.',
    flowType: 'authorization_code',
    startEndpoint: 'start',
  },
  {
    id: 'google',
    label: 'Google OAuth',
    description: 'Social OAuth flow with callback URL support.',
    flowType: 'authorization_code',
    startEndpoint: 'start-url',
  },
  {
    id: 'github',
    label: 'GitHub OAuth',
    description: 'Social OAuth flow via management API callback.',
    flowType: 'authorization_code',
    startEndpoint: 'start-url',
  },
];

export function isKiroAuthMethod(value: string): value is KiroAuthMethod {
  return KIRO_AUTH_METHODS.includes(value as KiroAuthMethod);
}

export function normalizeKiroAuthMethod(value?: string): KiroAuthMethod {
  if (!value) return DEFAULT_KIRO_AUTH_METHOD;
  const normalized = value.trim().toLowerCase();
  return isKiroAuthMethod(normalized) ? normalized : DEFAULT_KIRO_AUTH_METHOD;
}

export function getKiroAuthMethodOption(method: KiroAuthMethod): KiroAuthMethodOption {
  const option = KIRO_AUTH_METHOD_OPTIONS.find((candidate) => candidate.id === method);
  return option || KIRO_AUTH_METHOD_OPTIONS[0];
}
