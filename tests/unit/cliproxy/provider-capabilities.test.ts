import { describe, expect, it } from 'bun:test';
import {
  CLIPROXY_PROVIDER_IDS,
  DEVICE_CODE_PROVIDER_IDS,
  getOAuthCallbackPort,
  getOAuthFlowType,
  getProviderAliases,
  getProviderDefaultImageAnalysisModel,
  getProviderLogoAssetPath,
  getProviderDisplayName,
  getProvidersByOAuthFlow,
  getProvidersSupportingImageAnalysis,
  IMAGE_ANALYSIS_PROVIDER_IDS,
  NICKNAME_REQUIRED_PROVIDER_IDS,
  isCLIProxyProvider,
  mapExternalProviderName,
  providerRequiresNickname,
  supportsProviderImageAnalysis,
  supportsProviderQuota,
} from '../../../src/cliproxy/provider-capabilities';
import {
  OAUTH_CALLBACK_PORTS as DIAGNOSTIC_CALLBACK_PORTS,
  OAUTH_FLOW_TYPES,
} from '../../../src/management/oauth-port-diagnostics';
import {
  DEFAULT_KIRO_AUTH_METHOD,
  getKiroCallbackPort,
  getKiroCLIAuthFlag,
  normalizeKiroAuthMethod,
  OAUTH_CALLBACK_PORTS as AUTH_CALLBACK_PORTS,
  toKiroManagementMethod,
} from '../../../src/cliproxy/auth/auth-types';

describe('provider-capabilities', () => {
  it('keeps canonical provider IDs backward-compatible', () => {
    expect(CLIPROXY_PROVIDER_IDS).toEqual([
      'gemini',
      'codex',
      'agy',
      'qwen',
      'iflow',
      'kiro',
      'ghcp',
      'claude',
    ]);
  });

  it('validates provider IDs', () => {
    expect(isCLIProxyProvider('gemini')).toBe(true);
    expect(isCLIProxyProvider('ghcp')).toBe(true);
    expect(isCLIProxyProvider('not-a-provider')).toBe(false);
    expect(isCLIProxyProvider('Gemini')).toBe(false);
  });

  it('returns providers by OAuth flow capability', () => {
    expect(getProvidersByOAuthFlow('device_code')).toEqual(['qwen', 'kiro', 'ghcp']);
    expect(DEVICE_CODE_PROVIDER_IDS).toEqual(['qwen', 'kiro', 'ghcp']);
    expect(getProvidersByOAuthFlow('authorization_code')).toEqual([
      'gemini',
      'codex',
      'agy',
      'iflow',
      'claude',
    ]);
  });

  it('maps external provider aliases to canonical IDs', () => {
    expect(mapExternalProviderName('gemini-cli')).toBe('gemini');
    expect(mapExternalProviderName('antigravity')).toBe('agy');
    expect(mapExternalProviderName('codewhisperer')).toBe('kiro');
    expect(mapExternalProviderName('github-copilot')).toBe('ghcp');
    expect(mapExternalProviderName('copilot')).toBe('ghcp');
    expect(mapExternalProviderName('anthropic')).toBe('claude');
    expect(mapExternalProviderName('unknown-provider')).toBeNull();
  });

  it('exposes callback port and display name capabilities', () => {
    expect(getOAuthCallbackPort('qwen')).toBeNull();
    expect(getOAuthCallbackPort('kiro')).toBeNull();
    expect(getOAuthCallbackPort('gemini')).toBe(8085);
    expect(getProviderDisplayName('agy')).toBe('AntiGravity');
    expect(getProviderAliases('ghcp')).toEqual(['github-copilot', 'copilot']);
    expect(getProviderLogoAssetPath('claude')).toBe('/assets/providers/claude.svg');
    expect(getProviderDefaultImageAnalysisModel('kiro')).toBe('kiro-claude-haiku-4-5');
  });

  it('exposes provider feature flags and derived provider lists', () => {
    expect(supportsProviderQuota('agy')).toBe(true);
    expect(supportsProviderQuota('gemini')).toBe(false);
    expect(providerRequiresNickname('ghcp')).toBe(true);
    expect(providerRequiresNickname('qwen')).toBe(false);
    expect(supportsProviderImageAnalysis('iflow')).toBe(true);
    expect(NICKNAME_REQUIRED_PROVIDER_IDS).toEqual(['kiro', 'ghcp']);
    expect(IMAGE_ANALYSIS_PROVIDER_IDS).toEqual(CLIPROXY_PROVIDER_IDS);
    expect(getProvidersSupportingImageAnalysis()).toEqual(CLIPROXY_PROVIDER_IDS);
  });

  it('keeps diagnostics flow metadata in sync with provider capabilities', () => {
    for (const provider of CLIPROXY_PROVIDER_IDS) {
      expect(OAUTH_FLOW_TYPES[provider]).toBe(getOAuthFlowType(provider));
      expect(DIAGNOSTIC_CALLBACK_PORTS[provider]).toBe(getOAuthCallbackPort(provider));
    }
  });

  it('does not define callback ports for device code providers in auth constants', () => {
    for (const provider of getProvidersByOAuthFlow('device_code')) {
      expect(AUTH_CALLBACK_PORTS[provider]).toBeUndefined();
    }
  });

  it('maps Kiro auth methods to upstream CLI/management contracts', () => {
    expect(DEFAULT_KIRO_AUTH_METHOD).toBe('aws');
    expect(normalizeKiroAuthMethod()).toBe('aws');
    expect(normalizeKiroAuthMethod('GOOGLE')).toBe('google');
    expect(normalizeKiroAuthMethod('not-valid')).toBe('aws');

    expect(getKiroCLIAuthFlag('aws')).toBe('--kiro-aws-login');
    expect(getKiroCLIAuthFlag('aws-authcode')).toBe('--kiro-aws-authcode');
    expect(getKiroCLIAuthFlag('google')).toBe('--kiro-google-login');

    expect(getKiroCallbackPort('aws')).toBeNull();
    expect(getKiroCallbackPort('google')).toBe(9876);
    expect(getKiroCallbackPort('github')).toBe(9876);
    expect(getKiroCallbackPort('aws-authcode')).toBe(9876);

    expect(toKiroManagementMethod('aws')).toBe('aws');
    expect(toKiroManagementMethod('aws-authcode')).toBe('aws');
    expect(toKiroManagementMethod('google')).toBe('google');
    expect(toKiroManagementMethod('github')).toBe('github');
  });
});
