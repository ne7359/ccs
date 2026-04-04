import type { GeminiCliBucket } from './quota-types';

export interface GeminiCliParsedBucket {
  modelId: string;
  tokenType: string | null;
  remainingFraction: number | null;
  remainingAmount: number | null;
  resetTime: string | null;
}

interface GeminiCliQuotaGroupDefinition {
  id: string;
  label: string;
  preferredModelId?: string;
  modelIds: string[];
}

const GEMINI_CLI_QUOTA_GROUPS: GeminiCliQuotaGroupDefinition[] = [
  {
    id: 'gemini-flash-lite-series',
    label: 'Gemini Flash Lite Series',
    preferredModelId: 'gemini-2.5-flash-lite',
    modelIds: ['gemini-2.5-flash-lite'],
  },
  {
    id: 'gemini-flash-series',
    label: 'Gemini Flash Series',
    preferredModelId: 'gemini-3-flash-preview',
    modelIds: ['gemini-3-flash-preview', 'gemini-3.1-flash-preview', 'gemini-2.5-flash'],
  },
  {
    id: 'gemini-pro-series',
    label: 'Gemini Pro Series',
    preferredModelId: 'gemini-3.1-pro-preview',
    modelIds: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-2.5-pro'],
  },
];

const GEMINI_CLI_GROUP_ORDER = new Map(
  GEMINI_CLI_QUOTA_GROUPS.map((group, index) => [group.id, index] as const)
);

const GEMINI_CLI_GROUP_LOOKUP = new Map(
  GEMINI_CLI_QUOTA_GROUPS.flatMap((group) =>
    group.modelIds.map((modelId) => [modelId, group] as const)
  )
);

const GEMINI_CLI_IGNORED_MODEL_PREFIXES = ['gemini-2.0-flash'];

type GeminiCliQuotaBucketGroup = {
  id: string;
  label: string;
  tokenType: string | null;
  modelIds: string[];
  preferredModelId?: string;
  preferredBucket?: GeminiCliParsedBucket;
  fallbackRemainingFraction: number | null;
  fallbackRemainingAmount: number | null;
  fallbackResetTime: string | null;
};

function isIgnoredGeminiCliModel(modelId: string): boolean {
  return GEMINI_CLI_IGNORED_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

function pickEarlierResetTime(current: string | null, next: string | null): string | null {
  if (!current) return next;
  if (!next) return current;
  const currentTime = new Date(current).getTime();
  const nextTime = new Date(next).getTime();
  if (Number.isNaN(currentTime)) return next;
  if (Number.isNaN(nextTime)) return current;
  return currentTime <= nextTime ? current : next;
}

function minNullableNumber(current: number | null, next: number | null): number | null {
  if (current === null) return next;
  if (next === null) return current;
  return Math.min(current, next);
}

function clampQuotaFraction(value: number | null): number {
  if (value === null) return 0;
  return Math.max(0, Math.min(1, value));
}

function getGroupOrder(bucket: GeminiCliQuotaBucketGroup): number {
  return GEMINI_CLI_GROUP_ORDER.get(bucket.id) ?? Number.MAX_SAFE_INTEGER;
}

export function buildGeminiCliBucketsFromParsedBuckets(
  buckets: GeminiCliParsedBucket[]
): GeminiCliBucket[] {
  if (buckets.length === 0) return [];

  const grouped = new Map<string, GeminiCliQuotaBucketGroup>();

  for (const bucket of buckets) {
    if (isIgnoredGeminiCliModel(bucket.modelId)) continue;

    const group = GEMINI_CLI_GROUP_LOOKUP.get(bucket.modelId);
    const groupId = group?.id ?? bucket.modelId;
    const label = group?.label ?? bucket.modelId;
    const tokenKey = bucket.tokenType ?? '';
    const cacheKey = `${groupId}::${tokenKey || 'combined'}`;
    const existing = grouped.get(cacheKey);

    if (!existing) {
      const preferredModelId = group?.preferredModelId;
      grouped.set(cacheKey, {
        id: groupId,
        label,
        tokenType: bucket.tokenType,
        modelIds: [bucket.modelId],
        preferredModelId,
        preferredBucket:
          preferredModelId && bucket.modelId === preferredModelId ? bucket : undefined,
        fallbackRemainingFraction: bucket.remainingFraction,
        fallbackRemainingAmount: bucket.remainingAmount,
        fallbackResetTime: bucket.resetTime,
      });
      continue;
    }

    existing.modelIds.push(bucket.modelId);
    existing.fallbackRemainingFraction = minNullableNumber(
      existing.fallbackRemainingFraction,
      bucket.remainingFraction
    );
    existing.fallbackRemainingAmount = minNullableNumber(
      existing.fallbackRemainingAmount,
      bucket.remainingAmount
    );
    existing.fallbackResetTime = pickEarlierResetTime(existing.fallbackResetTime, bucket.resetTime);

    if (existing.preferredModelId && bucket.modelId === existing.preferredModelId) {
      existing.preferredBucket = bucket;
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => {
      const orderDiff = getGroupOrder(a) - getGroupOrder(b);
      if (orderDiff !== 0) return orderDiff;
      const tokenDiff = (a.tokenType ?? '').localeCompare(b.tokenType ?? '');
      if (tokenDiff !== 0) return tokenDiff;
      return a.label.localeCompare(b.label);
    })
    .map((bucket) => {
      const preferred = bucket.preferredBucket;
      const remainingFraction = clampQuotaFraction(
        preferred?.remainingFraction ?? bucket.fallbackRemainingFraction
      );
      const remainingAmount = preferred?.remainingAmount ?? bucket.fallbackRemainingAmount;
      const resetTime = preferred?.resetTime ?? bucket.fallbackResetTime;

      return {
        id: `${bucket.id}::${bucket.tokenType || 'combined'}`,
        label: bucket.label,
        tokenType: bucket.tokenType,
        remainingFraction,
        remainingPercent: Math.round(remainingFraction * 100),
        remainingAmount,
        resetTime,
        modelIds: Array.from(new Set(bucket.modelIds)),
      };
    });
}
