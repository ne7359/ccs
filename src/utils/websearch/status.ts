/**
 * WebSearch Status and Readiness
 *
 * Provides status checking and display functions for WebSearch.
 *
 * @module utils/websearch/status
 */

import { ok, warn, fail, info } from '../ui';
import { getWebSearchConfig } from '../../config/unified-config-loader';
import { getGeminiCliStatus, isGeminiAuthenticated } from './gemini-cli';
import { getGrokCliStatus } from './grok-cli';
import { getOpenCodeCliStatus } from './opencode-cli';
import { getWebSearchApiKeyStates } from './provider-secrets';
import type { WebSearchCliInfo, WebSearchStatus } from './types';

function hasEnvValue(name: string): boolean {
  return (process.env[name] || '').trim().length > 0;
}

function getLegacyProviderStatuses(): WebSearchCliInfo[] {
  const wsConfig = getWebSearchConfig();
  const geminiStatus = getGeminiCliStatus();
  const grokStatus = getGrokCliStatus();
  const opencodeStatus = getOpenCodeCliStatus();
  const geminiAuthed = geminiStatus.installed && isGeminiAuthenticated();

  return [
    {
      id: 'gemini',
      kind: 'legacy-cli',
      name: 'Gemini CLI',
      command: 'gemini',
      enabled: wsConfig.providers?.gemini?.enabled ?? false,
      available: geminiAuthed,
      version: geminiStatus.version ?? null,
      installCommand: 'npm install -g @google/gemini-cli',
      docsUrl: 'https://github.com/google-gemini/gemini-cli',
      requiresApiKey: false,
      description: 'Optional legacy LLM fallback with Google web search.',
      detail: geminiStatus.installed
        ? geminiAuthed
          ? 'Authenticated'
          : "Run 'gemini' to login"
        : 'Not installed',
    },
    {
      id: 'opencode',
      kind: 'legacy-cli',
      name: 'OpenCode',
      command: 'opencode',
      enabled: wsConfig.providers?.opencode?.enabled ?? false,
      available: opencodeStatus.installed,
      version: opencodeStatus.version ?? null,
      installCommand: 'curl -fsSL https://opencode.ai/install | bash',
      docsUrl: 'https://github.com/sst/opencode',
      requiresApiKey: false,
      description: 'Optional legacy LLM fallback via OpenCode.',
      detail: opencodeStatus.installed ? 'Installed' : 'Not installed',
    },
    {
      id: 'grok',
      kind: 'legacy-cli',
      name: 'Grok CLI',
      command: 'grok',
      enabled: wsConfig.providers?.grok?.enabled ?? false,
      available: grokStatus.installed && hasEnvValue('GROK_API_KEY'),
      version: grokStatus.version ?? null,
      installCommand: 'npm install -g @vibe-kit/grok-cli',
      docsUrl: 'https://github.com/superagent-ai/grok-cli',
      requiresApiKey: true,
      apiKeyEnvVar: 'GROK_API_KEY',
      description: 'Optional legacy LLM fallback with xAI Grok.',
      detail: grokStatus.installed
        ? hasEnvValue('GROK_API_KEY')
          ? 'Ready'
          : 'Set GROK_API_KEY'
        : 'Not installed',
    },
  ];
}

/**
 * Get all WebSearch providers with their current status.
 */
export function getWebSearchCliProviders(): WebSearchCliInfo[] {
  const wsConfig = getWebSearchConfig();
  const apiKeyStates = getWebSearchApiKeyStates();
  const providers: WebSearchCliInfo[] = [
    {
      id: 'exa',
      kind: 'backend',
      name: 'Exa',
      enabled: wsConfig.providers?.exa?.enabled ?? false,
      available: (wsConfig.providers?.exa?.enabled ?? false) && apiKeyStates.exa.available,
      version: null,
      docsUrl: 'https://docs.exa.ai/reference/search',
      requiresApiKey: true,
      apiKeyEnvVar: 'EXA_API_KEY',
      description: 'API-backed search with strong relevance and content extraction.',
      detail: apiKeyStates.exa.available
        ? `API key detected (${wsConfig.providers?.exa?.max_results ?? 5} results)`
        : apiKeyStates.exa.configured
          ? 'Stored in dashboard, but Global Env is disabled'
          : 'Set EXA_API_KEY',
    },
    {
      id: 'tavily',
      kind: 'backend',
      name: 'Tavily',
      enabled: wsConfig.providers?.tavily?.enabled ?? false,
      available: (wsConfig.providers?.tavily?.enabled ?? false) && apiKeyStates.tavily.available,
      version: null,
      docsUrl: 'https://docs.tavily.com/documentation/api-reference/endpoint/search',
      requiresApiKey: true,
      apiKeyEnvVar: 'TAVILY_API_KEY',
      description: 'Search API optimized for agent workflows and concise web result synthesis.',
      detail: apiKeyStates.tavily.available
        ? `API key detected (${wsConfig.providers?.tavily?.max_results ?? 5} results)`
        : apiKeyStates.tavily.configured
          ? 'Stored in dashboard, but Global Env is disabled'
          : 'Set TAVILY_API_KEY',
    },
    {
      id: 'duckduckgo',
      kind: 'backend',
      name: 'DuckDuckGo',
      enabled: wsConfig.providers?.duckduckgo?.enabled ?? true,
      available: wsConfig.providers?.duckduckgo?.enabled ?? true,
      version: null,
      docsUrl: 'https://duckduckgo.com',
      requiresApiKey: false,
      description: 'Default built-in HTML search backend. Zero setup.',
      detail: `Built-in (${wsConfig.providers?.duckduckgo?.max_results ?? 5} results)`,
    },
    {
      id: 'brave',
      kind: 'backend',
      name: 'Brave Search',
      enabled: wsConfig.providers?.brave?.enabled ?? false,
      available: (wsConfig.providers?.brave?.enabled ?? false) && apiKeyStates.brave.available,
      version: null,
      docsUrl: 'https://brave.com/search/api/',
      requiresApiKey: true,
      apiKeyEnvVar: 'BRAVE_API_KEY',
      description: 'API-backed web search with cleaner result metadata.',
      detail: apiKeyStates.brave.available
        ? `API key detected (${wsConfig.providers?.brave?.max_results ?? 5} results)`
        : apiKeyStates.brave.configured
          ? 'Stored in dashboard, but Global Env is disabled'
          : 'Set BRAVE_API_KEY',
    },
  ];

  return [...providers, ...getLegacyProviderStatuses()];
}

/**
 * Check if any WebSearch provider is currently ready.
 */
export function hasAnyWebSearchCli(): boolean {
  return getWebSearchCliProviders().some((provider) => provider.enabled && provider.available);
}

/**
 * Get setup hints when no providers are ready.
 */
export function getCliInstallHints(): string[] {
  if (hasAnyWebSearchCli()) {
    return [];
  }

  return [
    'WebSearch: no ready providers',
    '    Enable DuckDuckGo in Settings > WebSearch for zero-setup search',
    '    Or export EXA_API_KEY, TAVILY_API_KEY, or BRAVE_API_KEY for API-backed search',
    '    Optional legacy fallback: npm i -g @google/gemini-cli',
  ];
}

export function buildWebSearchReadiness(
  enabled: boolean,
  providers: WebSearchCliInfo[]
): WebSearchStatus {
  if (!enabled) {
    return {
      readiness: 'unavailable',
      message: 'Disabled in config',
      providers,
    };
  }

  const enabledProviders = providers.filter((provider) => provider.enabled);
  const readyProviders = enabledProviders.filter((provider) => provider.available);

  if (readyProviders.length > 0) {
    return {
      readiness: 'ready',
      message: `Ready (${readyProviders.map((provider) => provider.name).join(' + ')})`,
      providers,
    };
  }

  if (enabledProviders.length > 0) {
    return {
      readiness: 'needs_setup',
      message: enabledProviders
        .map((provider) => `${provider.name}: ${provider.detail}`)
        .join(' | '),
      providers,
    };
  }

  return {
    readiness: 'unavailable',
    message: 'Enable at least one provider in Settings > WebSearch',
    providers,
  };
}

/**
 * Get WebSearch readiness status for display.
 */
export function getWebSearchReadiness(): WebSearchStatus {
  const wsConfig = getWebSearchConfig();
  const providers = getWebSearchCliProviders();
  return buildWebSearchReadiness(wsConfig.enabled, providers);
}

/**
 * Display WebSearch status (single line, equilibrium UX).
 */
export function displayWebSearchStatus(): void {
  const status = getWebSearchReadiness();

  switch (status.readiness) {
    case 'ready':
      console.error(ok(`WebSearch: ${status.message}`));
      break;
    case 'needs_setup':
      console.error(warn(`WebSearch: ${status.message}`));
      break;
    case 'unavailable':
      console.error(fail(`WebSearch: ${status.message}`));
      for (const [index, hint] of getCliInstallHints().entries()) {
        console.error(index === 0 ? info(hint) : hint);
      }
      break;
  }
}
