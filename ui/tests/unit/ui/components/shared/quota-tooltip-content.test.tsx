import { render, screen } from '@tests/setup/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { QuotaTooltipContent } from '@/components/shared/quota-tooltip-content';
import type { GeminiCliQuotaResult } from '@/lib/api-client';

function createGeminiQuotaResult(
  overrides: Partial<GeminiCliQuotaResult> = {}
): GeminiCliQuotaResult {
  return {
    success: true,
    buckets: [
      {
        id: 'gemini-flash-lite-series::combined',
        label: 'Gemini Flash Lite Series',
        tokenType: null,
        remainingFraction: 1,
        remainingPercent: 100,
        remainingAmount: 100,
        resetTime: '2026-01-30T09:00:00Z',
        modelIds: ['gemini-2.5-flash-lite'],
      },
      {
        id: 'gemini-flash-series::combined',
        label: 'Gemini Flash Series',
        tokenType: null,
        remainingFraction: 0.82,
        remainingPercent: 82,
        remainingAmount: 82,
        resetTime: '2026-01-30T14:00:00Z',
        modelIds: ['gemini-3-flash-preview'],
      },
    ],
    projectId: 'cloudaicompanion-test-123',
    tierLabel: 'Pro',
    tierId: 'g1-pro-tier',
    creditBalance: 12,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

describe('QuotaTooltipContent', () => {
  it('renders Gemini tier, credits, remaining amount, and bucket reset timestamps', () => {
    const quota = createGeminiQuotaResult();
    const expectedReset = new Date('2026-01-30T14:00:00Z').toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    render(<QuotaTooltipContent quota={quota} resetTime={quota.buckets[0].resetTime} />);

    expect(screen.getByText('Tier')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Credits')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Gemini Flash Lite Series')).toBeInTheDocument();
    expect(screen.getByText('100 remaining')).toBeInTheDocument();
    expect(screen.getByText('82 remaining')).toBeInTheDocument();
    expect(screen.getByText(expectedReset)).toBeInTheDocument();
  });

  it('falls back to the shared reset indicator when Gemini buckets omit reset timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-29T00:00:00Z'));

    const quota = createGeminiQuotaResult({
      buckets: [
        {
          id: 'gemini-flash-series::combined',
          label: 'Gemini Flash Series',
          tokenType: null,
          remainingFraction: 0.75,
          remainingPercent: 75,
          remainingAmount: 75,
          resetTime: null,
          modelIds: ['gemini-3-flash-preview'],
        },
      ],
      creditBalance: null,
      tierLabel: null,
      tierId: null,
    });

    render(<QuotaTooltipContent quota={quota} resetTime="2026-01-29T03:00:00Z" />);

    expect(screen.getByText(/Resets/i)).toBeInTheDocument();

    vi.useRealTimers();
  });
});
