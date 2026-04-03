/**
 * Shared Quota Tooltip Content Component
 * Displays provider-specific quota information in tooltips
 */

import { Clock } from 'lucide-react';
import {
  cn,
  formatQuotaPercent,
  formatResetTime,
  getCodexQuotaBreakdown,
  getQuotaFailureInfo,
  getCodexWindowDisplayLabel,
  getModelsWithTiers,
  groupModelsByTier,
  isAgyQuotaResult,
  isClaudeQuotaResult,
  isCodexQuotaResult,
  isGeminiQuotaResult,
  isGhcpQuotaResult,
  type ModelTier,
  type UnifiedQuotaResult,
} from '@/lib/utils';

interface QuotaTooltipContentProps {
  quota: UnifiedQuotaResult | null | undefined;
  resetTime: string | null;
}

function formatPlanLabel(planType: string | null | undefined): string | null {
  if (!planType) return null;
  const normalized = planType
    .split(/[\s_-]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return normalized.length > 0 ? normalized.join(' ') : planType;
}

function formatAbsoluteResetTime(resetTime: string | null): string | null {
  if (!resetTime) return null;
  try {
    const parsed = new Date(resetTime);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return null;
  }
}

function getClaudeWindowDisplayLabel(rateLimitType: string, fallback: string): string {
  switch (rateLimitType) {
    case 'five_hour':
      return '5h usage limit';
    case 'seven_day':
      return 'Weekly usage limit';
    case 'seven_day_opus':
      return 'Weekly usage (Opus)';
    case 'seven_day_sonnet':
      return 'Weekly usage (Sonnet)';
    case 'seven_day_oauth_apps':
      return 'Weekly usage (OAuth apps)';
    case 'seven_day_cowork':
      return 'Weekly usage (Cowork)';
    case 'overage':
      return 'Extra usage';
    default:
      return fallback;
  }
}

/**
 * Renders provider-specific quota tooltip content
 * Uses type guards for proper TypeScript narrowing
 */
export function QuotaTooltipContent({ quota, resetTime }: QuotaTooltipContentProps) {
  if (!quota) {
    return <p className="text-xs text-muted-foreground">Loading quota...</p>;
  }

  if (!quota.success) {
    const failureInfo = getQuotaFailureInfo(quota);
    return (
      <div className="text-xs space-y-1">
        <p className="font-medium text-destructive">
          {failureInfo?.label || quota.error || 'Failed to load quota'}
        </p>
        <p className="text-destructive/90">{failureInfo?.summary || quota.error}</p>
        {failureInfo?.actionHint && (
          <p className="text-muted-foreground">{failureInfo.actionHint}</p>
        )}
        {failureInfo?.technicalDetail && (
          <p className="font-mono text-[11px] text-muted-foreground">
            {failureInfo.technicalDetail}
          </p>
        )}
        {failureInfo?.rawDetail && (
          <pre className="whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {failureInfo.rawDetail}
          </pre>
        )}
      </div>
    );
  }

  // Antigravity (agy) provider tooltip
  if (isAgyQuotaResult(quota)) {
    const tiered = getModelsWithTiers(quota.models || []);
    const groups = groupModelsByTier(tiered);
    const tierOrder: ModelTier[] = ['primary', 'gemini-3', 'gemini-2', 'other'];

    return (
      <div className="text-xs space-y-1">
        <p className="font-medium">Model Quotas:</p>
        {tierOrder.map((tier, idx) => {
          const models = groups.get(tier);
          if (!models || models.length === 0) return null;
          const isFirst = tierOrder.slice(0, idx).every((t) => !groups.get(t)?.length);
          return (
            <div key={tier}>
              {!isFirst && <div className="border-t border-border/40 my-1" />}
              {models.map((m) => (
                <div key={m.name} className="flex justify-between gap-4">
                  <span className={cn('truncate', m.exhausted && 'text-red-500')}>
                    {m.displayName}
                  </span>
                  <span className={cn('font-mono', m.exhausted && 'text-red-500')}>
                    {m.percentage}%
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        <ResetTimeIndicator resetTime={resetTime} />
      </div>
    );
  }

  // Codex provider tooltip
  if (isCodexQuotaResult(quota)) {
    const { fiveHourWindow, weeklyWindow, codeReviewWindows, unknownWindows } =
      getCodexQuotaBreakdown(quota.windows);
    const fiveHourResetAt = quota.coreUsage?.fiveHour?.resetAt ?? fiveHourWindow?.resetAt ?? null;
    const weeklyResetAt = quota.coreUsage?.weekly?.resetAt ?? weeklyWindow?.resetAt ?? null;
    const orderedWindows = [fiveHourWindow, weeklyWindow, ...codeReviewWindows, ...unknownWindows]
      .filter((w): w is NonNullable<typeof w> => !!w)
      .filter(
        (w, index, arr) =>
          arr.findIndex(
            (candidate) => candidate.label === w.label && candidate.resetAt === w.resetAt
          ) === index
      );

    return (
      <div className="text-xs space-y-1">
        <p className="font-medium">Rate Limits:</p>
        {quota.planType && <p className="text-muted-foreground">Plan: {quota.planType}</p>}
        {orderedWindows.map((w, index) => (
          <div
            key={`${w.label}-${w.resetAt ?? 'no-reset'}-${index}`}
            className="flex justify-between gap-4"
          >
            <span className={cn(w.remainingPercent < 20 && 'text-red-500')}>
              {getCodexWindowDisplayLabel(w, orderedWindows)}
            </span>
            <span className="font-mono">{w.remainingPercent}%</span>
          </div>
        ))}
        <CodexResetIndicators
          fiveHourResetTime={fiveHourResetAt}
          weeklyResetTime={weeklyResetAt}
          fallbackResetTime={resetTime}
        />
      </div>
    );
  }

  // Claude provider tooltip
  if (isClaudeQuotaResult(quota)) {
    const coreWindows = [quota.coreUsage?.fiveHour, quota.coreUsage?.weekly]
      .filter((window): window is NonNullable<typeof window> => !!window)
      .map((window) => ({
        rateLimitType: window.rateLimitType,
        label: window.label,
        remainingPercent: window.remainingPercent,
        resetAt: window.resetAt,
        status: window.status,
      }));
    const policyWindows = quota.windows.map((window) => ({
      rateLimitType: window.rateLimitType,
      label: window.label,
      remainingPercent: window.remainingPercent,
      resetAt: window.resetAt,
      status: window.status,
    }));
    const orderedWindows = [...coreWindows, ...policyWindows].filter(
      (window, index, arr) =>
        arr.findIndex(
          (candidate) =>
            candidate.rateLimitType === window.rateLimitType &&
            candidate.resetAt === window.resetAt &&
            candidate.status === window.status
        ) === index
    );

    const fiveHourResetAt =
      quota.coreUsage?.fiveHour?.resetAt ??
      quota.windows.find((window) => window.rateLimitType === 'five_hour')?.resetAt ??
      null;
    const weeklyResetAt =
      quota.coreUsage?.weekly?.resetAt ??
      quota.windows.find((window) =>
        [
          'seven_day',
          'seven_day_opus',
          'seven_day_sonnet',
          'seven_day_oauth_apps',
          'seven_day_cowork',
        ].includes(window.rateLimitType)
      )?.resetAt ??
      null;

    return (
      <div className="text-xs space-y-1">
        <p className="font-medium">Rate Limits:</p>
        {orderedWindows.map((window, index) => (
          <div
            key={`${window.rateLimitType}-${window.resetAt ?? 'no-reset'}-${window.status}-${index}`}
            className="flex justify-between gap-4"
          >
            <span className={cn(window.remainingPercent < 20 && 'text-red-500')}>
              {getClaudeWindowDisplayLabel(window.rateLimitType, window.label)}
            </span>
            <span className="font-mono">{window.remainingPercent}%</span>
          </div>
        ))}
        <CodexResetIndicators
          fiveHourResetTime={fiveHourResetAt}
          weeklyResetTime={weeklyResetAt}
          fallbackResetTime={resetTime}
        />
      </div>
    );
  }

  // Gemini provider tooltip
  if (isGeminiQuotaResult(quota)) {
    const hasBucketResetTime = quota.buckets.some((bucket) => !!bucket.resetTime);

    return (
      <div className="text-xs space-y-1">
        {quota.tierLabel && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Tier</span>
            <span className="font-mono">{quota.tierLabel}</span>
          </div>
        )}
        {quota.creditBalance !== null && quota.creditBalance !== undefined && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Credits</span>
            <span className="font-mono">{quota.creditBalance.toLocaleString()}</span>
          </div>
        )}
        <p className="font-medium">Buckets:</p>
        {quota.buckets.map((b) => (
          <div key={b.id} className="space-y-0.5">
            <div className="flex justify-between gap-4">
              <span className={cn(b.remainingPercent < 20 && 'text-red-500')}>
                {b.label}
                {b.tokenType ? ` (${b.tokenType})` : ''}
              </span>
              <span className="font-mono">{b.remainingPercent}%</span>
            </div>
            {((b.remainingAmount !== null && b.remainingAmount !== undefined) || b.resetTime) && (
              <div className="flex justify-between gap-4 text-[11px] text-muted-foreground">
                <span>
                  {b.remainingAmount !== null && b.remainingAmount !== undefined
                    ? `${b.remainingAmount.toLocaleString()} remaining`
                    : ''}
                </span>
                <span>{formatAbsoluteResetTime(b.resetTime) ?? ''}</span>
              </div>
            )}
          </div>
        ))}
        {!hasBucketResetTime && <ResetTimeIndicator resetTime={resetTime} />}
      </div>
    );
  }

  // GitHub Copilot (ghcp) provider tooltip
  if (isGhcpQuotaResult(quota)) {
    const snapshotRows = [
      { label: 'Premium Interactions', snapshot: quota.snapshots.premiumInteractions },
      { label: 'Chat', snapshot: quota.snapshots.chat },
      { label: 'Completions', snapshot: quota.snapshots.completions },
    ];
    const effectiveResetTime = quota.quotaResetDate ?? resetTime;
    const planLabel = formatPlanLabel(quota.planType);

    return (
      <div className="text-xs space-y-1">
        <p className="font-medium">Quota Snapshots:</p>
        {planLabel && <p className="text-muted-foreground">Plan: {planLabel}</p>}
        {snapshotRows.map(({ label, snapshot }) => {
          const isLow = snapshot.percentRemaining < 20;
          return (
            <div key={label} className="space-y-0.5">
              <div className="flex justify-between gap-4">
                <span className={cn(isLow && 'text-red-500')}>{label}</span>
                <span className={cn('font-mono', isLow && 'text-red-500')}>
                  {snapshot.unlimited
                    ? 'Unlimited'
                    : `${formatQuotaPercent(snapshot.percentRemaining)}%`}
                </span>
              </div>
              {!snapshot.unlimited && (
                <div className="text-[11px] text-muted-foreground">
                  {snapshot.remaining}/{snapshot.entitlement} remaining
                </div>
              )}
            </div>
          );
        })}
        <ResetTimeIndicator resetTime={effectiveResetTime} />
      </div>
    );
  }

  return null;
}

/**
 * Reset time indicator shown at bottom of tooltip
 */
function ResetTimeIndicator({ resetTime }: { resetTime: string | null }) {
  if (!resetTime) return null;

  return (
    <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
      <Clock className="w-3 h-3 text-blue-400" />
      <span className="text-blue-400 font-medium">Resets {formatResetTime(resetTime)}</span>
    </div>
  );
}

function CodexResetIndicators({
  fiveHourResetTime,
  weeklyResetTime,
  fallbackResetTime,
}: {
  fiveHourResetTime: string | null;
  weeklyResetTime: string | null;
  fallbackResetTime: string | null;
}) {
  const hasSpecificReset = !!fiveHourResetTime || !!weeklyResetTime;
  if (!hasSpecificReset && !fallbackResetTime) return null;

  return (
    <div className="pt-1 border-t border-border/50 space-y-1">
      {fiveHourResetTime && (
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-blue-400" />
          <span className="text-blue-400 font-medium">
            5h resets {formatResetTime(fiveHourResetTime)}
          </span>
        </div>
      )}
      {weeklyResetTime && (
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-indigo-400" />
          <span className="text-indigo-400 font-medium">
            Weekly resets {formatResetTime(weeklyResetTime)}
          </span>
        </div>
      )}
      {!hasSpecificReset && fallbackResetTime && (
        <ResetTimeIndicator resetTime={fallbackResetTime} />
      )}
    </div>
  );
}
