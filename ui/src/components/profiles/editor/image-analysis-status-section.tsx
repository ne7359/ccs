import { ArrowUpRight, Image as ImageIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { CliTarget, ImageAnalysisStatus } from '@/lib/api-client';

interface ImageAnalysisStatusSectionProps {
  status?: ImageAnalysisStatus | null;
  target?: CliTarget;
  source?: 'saved' | 'editor';
  previewState?: 'saved' | 'preview' | 'refreshing' | 'invalid';
  nativeReadPreferenceOverride?: boolean;
  onToggleNativeRead?: (enabled: boolean) => void;
}

const TARGET_LABELS: Record<CliTarget, string> = {
  claude: 'Claude Code',
  droid: 'Factory Droid',
  codex: 'Codex CLI',
};

function getPreviewLabel(
  source: 'saved' | 'editor',
  previewState: ImageAnalysisStatusSectionProps['previewState']
) {
  if (previewState === 'refreshing') return 'Refreshing preview';
  if (previewState === 'invalid') return 'Saved status';
  return source === 'editor' ? 'Live preview' : 'Saved status';
}

function getHeaderLabel(status: ImageAnalysisStatus, target: CliTarget): string {
  if (status.status === 'disabled') return 'Disabled globally';
  if (target !== 'claude') return `${TARGET_LABELS[target]} bypasses the hook`;
  if (status.nativeReadPreference) return 'Native image reading';
  if (status.status === 'hook-missing') return 'Setup needed';
  if (status.authReadiness === 'missing') return 'Needs auth';
  if (status.proxyReadiness === 'unavailable') return 'Needs proxy';
  if (status.effectiveRuntimeMode === 'native-read') return 'Native fallback';
  return 'Transformer ready';
}

function getHeaderBadge(
  status: ImageAnalysisStatus,
  target: CliTarget
): {
  label: string;
  className: string;
} {
  if (status.status === 'disabled') {
    return {
      label: 'Disabled',
      className: 'border-border/80 bg-background/85 text-muted-foreground',
    };
  }
  if (target !== 'claude') {
    return {
      label: 'Bypassed',
      className: 'border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-200',
    };
  }
  if (status.nativeReadPreference) {
    return {
      label: 'Native',
      className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    };
  }
  if (status.status === 'hook-missing' || status.authReadiness === 'missing') {
    return {
      label: status.status === 'hook-missing' ? 'Setup' : 'Auth',
      className: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    };
  }
  if (status.proxyReadiness === 'unavailable') {
    return {
      label: 'Proxy',
      className: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    };
  }
  return {
    label: 'Ready',
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  };
}

function getToggleSummary(status: ImageAnalysisStatus, target: CliTarget): string {
  if (status.nativeReadPreference) {
    if (status.profileModel && status.nativeImageCapable) {
      return `${status.profileModel} looks image-ready. CCS will bypass the transformer here.`;
    }
    if (status.profileModel) {
      return `CCS will prefer native reading for ${status.profileModel}.`;
    }
    return 'CCS will prefer native image reading for this profile.';
  }

  if (!status.backendDisplayName && target === 'claude') {
    return 'This profile currently stays on native file access.';
  }

  if (!status.backendDisplayName) {
    return `Saved Claude-side image routing is inactive while ${TARGET_LABELS[target]} is selected.`;
  }

  const modelSuffix = status.model ? ` · ${status.model}` : '';
  return `Transformer route: ${status.backendDisplayName}${modelSuffix}.`;
}

function getExceptionalNote(status: ImageAnalysisStatus, target: CliTarget): string | null {
  if (status.status === 'disabled') {
    return 'Image is disabled globally in CCS settings.';
  }
  if (target !== 'claude') {
    return `Current target ${TARGET_LABELS[target]} bypasses the Claude Read hook.`;
  }
  if (status.nativeReadPreference) {
    return status.nativeImageCapable === true ? null : status.nativeImageReason;
  }
  if (status.status === 'hook-missing') {
    return 'Persist the profile hook before transformer routing can run here.';
  }
  if (status.authReadiness === 'missing') {
    return status.authReason;
  }
  if (status.proxyReadiness === 'unavailable') {
    return status.proxyReason;
  }
  return null;
}

export function ImageAnalysisStatusSection({
  status,
  target = 'claude',
  source = 'saved',
  previewState = 'saved',
  nativeReadPreferenceOverride,
  onToggleNativeRead,
}: ImageAnalysisStatusSectionProps) {
  if (!status) {
    return (
      <div className="rounded-2xl border bg-muted/20 px-4 py-3" aria-live="polite">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-3 w-52 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const nativeReadChecked = nativeReadPreferenceOverride ?? status.nativeReadPreference;
  const effectiveStatus = { ...status, nativeReadPreference: nativeReadChecked };
  const headerBadge = getHeaderBadge(effectiveStatus, target);
  const note = getExceptionalNote(effectiveStatus, target);
  const capabilityLabel = status.nativeImageCapable
    ? 'Verified'
    : status.profileModel
      ? 'Unknown'
      : null;

  return (
    <section className="rounded-2xl border bg-background/95 px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <ImageIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">Image</h3>
                <Badge className={cn('h-5 border px-1.5 text-[10px]', headerBadge.className)}>
                  {headerBadge.label}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {getPreviewLabel(source, previewState)} · {getHeaderLabel(effectiveStatus, target)}
              </p>
            </div>
          </div>
        </div>

        <Button size="sm" variant="outline" className="h-8 shrink-0" asChild>
          <Link to="/settings?tab=image">
            Open Settings
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <div className="mt-3 rounded-xl border bg-muted/15 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium text-foreground">Use native image reading</div>
              {capabilityLabel && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {capabilityLabel}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {getToggleSummary(effectiveStatus, target)}
            </p>
          </div>

          <Switch
            checked={nativeReadChecked}
            onCheckedChange={onToggleNativeRead}
            disabled={!onToggleNativeRead}
            aria-label="Use native image reading"
          />
        </div>
      </div>

      {note && (
        <div className="mt-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {note}
        </div>
      )}
    </section>
  );
}
