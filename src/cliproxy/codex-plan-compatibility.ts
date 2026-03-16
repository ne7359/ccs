import { getDefaultAccount } from './account-manager';
import { fetchCodexQuota } from './quota-fetcher-codex';
import { getCachedQuota, setCachedQuota } from './quota-response-cache';
import type { CodexQuotaResult } from './quota-types';
import { updateSettingsModel } from './services/variant-settings';
import { info, warn } from '../utils/ui';

export type CodexPlanType = CodexQuotaResult['planType'];

const FREE_SAFE_DEFAULT_MODEL = 'gpt-5-codex';
const FREE_SAFE_FAST_MODEL = 'gpt-5-codex-mini';
const CODEX_EFFORT_SUFFIX_REGEX = /-(xhigh|high|medium)$/i;
const CODEX_PAREN_SUFFIX_REGEX = /\((xhigh|high|medium)\)$/i;
const EXTENDED_CONTEXT_SUFFIX_REGEX = /\[1m\]$/i;

const FREE_PLAN_FALLBACKS = new Map<string, string>([
  ['gpt-5.3-codex', FREE_SAFE_DEFAULT_MODEL],
  ['gpt-5.3-codex-spark', FREE_SAFE_FAST_MODEL],
  ['gpt-5.4', FREE_SAFE_DEFAULT_MODEL],
]);

function normalizeCodexModelId(model: string): string {
  return model
    .trim()
    .replace(EXTENDED_CONTEXT_SUFFIX_REGEX, '')
    .replace(CODEX_PAREN_SUFFIX_REGEX, '')
    .replace(CODEX_EFFORT_SUFFIX_REGEX, '')
    .trim()
    .toLowerCase();
}

export function getDefaultCodexModel(): string {
  return FREE_SAFE_DEFAULT_MODEL;
}

export function getFreePlanFallbackCodexModel(model: string): string | null {
  return FREE_PLAN_FALLBACKS.get(normalizeCodexModelId(model)) ?? null;
}

export async function reconcileCodexModelForActivePlan(options: {
  settingsPath: string;
  currentModel: string | undefined;
  verbose: boolean;
}): Promise<void> {
  const { settingsPath, currentModel, verbose } = options;
  if (!currentModel) return;

  const fallbackModel = getFreePlanFallbackCodexModel(currentModel);
  if (!fallbackModel) return;

  const defaultAccount = getDefaultAccount('codex');
  if (!defaultAccount) {
    console.error(
      warn(
        `Configured Codex model "${normalizeCodexModelId(currentModel)}" may require a paid Codex plan. ` +
          `If startup fails, switch to "${fallbackModel}" with "ccs codex --config".`
      )
    );
    return;
  }

  const cachedQuota = getCachedQuota<CodexQuotaResult>('codex', defaultAccount.id);
  const quota = cachedQuota ?? (await fetchCodexQuota(defaultAccount.id, verbose));
  if (!cachedQuota) {
    setCachedQuota('codex', defaultAccount.id, quota);
  }

  if (quota.planType === 'free') {
    updateSettingsModel(settingsPath, fallbackModel, 'codex', {
      rewriteHaikuModel: (haikuModel) => getFreePlanFallbackCodexModel(haikuModel) ?? haikuModel,
    });
    console.error(
      info(
        `Codex free plan detected. Switched unsupported model "${normalizeCodexModelId(currentModel)}" ` +
          `to "${fallbackModel}".`
      )
    );
    return;
  }

  if (quota.planType) {
    return;
  }

  console.error(
    warn(
      `Could not verify Codex plan for model "${normalizeCodexModelId(currentModel)}". ` +
        `If startup fails with model_not_supported, switch to "${fallbackModel}" via "ccs codex --config".`
    )
  );
}
