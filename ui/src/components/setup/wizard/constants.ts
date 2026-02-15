/**
 * Constants for Quick Setup Wizard
 * Provider display info with custom ordering for wizard UI.
 * Provider IDs must match CLIPROXY_PROVIDERS from provider-config.ts
 */

import type { ProviderOption } from './types';
import { getProviderSetupInfo, WIZARD_PROVIDER_ORDER } from '@/lib/provider-config';

export const PROVIDERS: ProviderOption[] = WIZARD_PROVIDER_ORDER.map((id) => {
  const providerInfo = getProviderSetupInfo(id);
  return {
    id,
    name: providerInfo.name,
    description: providerInfo.description,
  };
});

export const ALL_STEPS = ['provider', 'auth', 'variant', 'success'];

export function getStepProgress(step: string): number {
  if (step === 'account') return 1; // Same as auth
  return ALL_STEPS.indexOf(step);
}
