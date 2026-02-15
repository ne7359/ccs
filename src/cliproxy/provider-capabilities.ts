import type { CLIProxyProvider } from './types';

export type OAuthFlowType = 'authorization_code' | 'device_code';

export interface ProviderCapabilities {
  displayName: string;
  oauthFlow: OAuthFlowType;
  callbackPort: number | null;
  /**
   * Alternative provider names used by CLIProxyAPI or stats endpoints.
   * These aliases normalize external names to canonical CCS provider IDs.
   */
  aliases: readonly string[];
}

export const PROVIDER_CAPABILITIES: Record<CLIProxyProvider, ProviderCapabilities> = {
  gemini: {
    displayName: 'Google Gemini',
    oauthFlow: 'authorization_code',
    callbackPort: 8085,
    aliases: ['gemini-cli'],
  },
  codex: {
    displayName: 'Codex',
    oauthFlow: 'authorization_code',
    callbackPort: 1455,
    aliases: [],
  },
  agy: {
    displayName: 'AntiGravity',
    oauthFlow: 'authorization_code',
    callbackPort: 51121,
    aliases: ['antigravity'],
  },
  qwen: {
    displayName: 'Qwen',
    oauthFlow: 'device_code',
    callbackPort: null,
    aliases: [],
  },
  iflow: {
    displayName: 'iFlow',
    oauthFlow: 'authorization_code',
    callbackPort: 11451,
    aliases: [],
  },
  kiro: {
    displayName: 'Kiro (AWS)',
    oauthFlow: 'device_code',
    callbackPort: null,
    aliases: ['codewhisperer'],
  },
  ghcp: {
    displayName: 'GitHub Copilot (OAuth)',
    oauthFlow: 'device_code',
    callbackPort: null,
    aliases: ['github-copilot', 'copilot'],
  },
  claude: {
    displayName: 'Claude',
    oauthFlow: 'authorization_code',
    callbackPort: 54545,
    aliases: ['anthropic'],
  },
};

export const CLIPROXY_PROVIDER_IDS = Object.freeze(
  Object.keys(PROVIDER_CAPABILITIES) as CLIProxyProvider[]
);

const PROVIDER_ID_SET = new Set(CLIPROXY_PROVIDER_IDS);

const PROVIDER_ALIAS_MAP: ReadonlyMap<string, CLIProxyProvider> = (() => {
  const entries: Array<[string, CLIProxyProvider]> = [];
  for (const provider of CLIPROXY_PROVIDER_IDS) {
    entries.push([provider, provider]);
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

export function getProvidersByOAuthFlow(flowType: OAuthFlowType): CLIProxyProvider[] {
  return CLIPROXY_PROVIDER_IDS.filter(
    (provider) => PROVIDER_CAPABILITIES[provider].oauthFlow === flowType
  );
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
