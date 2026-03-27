import type { KeyboardEvent, ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface ProviderFieldConfig {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'number';
  helpText?: string;
  saved?: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export interface ProviderCardProps {
  title: string;
  description: string;
  detail: string;
  badge: string;
  badgeTone: 'green' | 'blue' | 'amber' | 'cyan' | 'slate';
  statusLabel: string;
  statusTone: 'ready' | 'setup' | 'idle';
  enabled: boolean;
  saving: boolean;
  onToggle: () => void;
  fields?: ProviderFieldConfig[];
  docsUrl?: string;
  installCommand?: string;
  footerNote?: string;
  children?: ReactNode;
}

const PROVIDER_TONE_STYLES = {
  green: {
    accent: 'from-emerald-500 via-lime-400 to-transparent',
    badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    glow: 'bg-emerald-500/18 dark:bg-emerald-500/22',
    surface:
      'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-background to-background dark:from-emerald-500/14',
    switchFrame: 'border-emerald-500/20 bg-emerald-500/10',
  },
  blue: {
    accent: 'from-sky-500 via-blue-500 to-transparent',
    badge: 'border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-200',
    glow: 'bg-sky-500/18 dark:bg-sky-500/22',
    surface:
      'border-sky-500/30 bg-gradient-to-br from-sky-500/10 via-background to-background dark:from-sky-500/14',
    switchFrame: 'border-sky-500/20 bg-sky-500/10',
  },
  amber: {
    accent: 'from-amber-500 via-orange-500 to-transparent',
    badge: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    glow: 'bg-amber-500/18 dark:bg-amber-500/22',
    surface:
      'border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-background to-background dark:from-amber-500/14',
    switchFrame: 'border-amber-500/20 bg-amber-500/10',
  },
  cyan: {
    accent: 'from-cyan-500 via-teal-400 to-transparent',
    badge: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200',
    glow: 'bg-cyan-500/18 dark:bg-cyan-500/22',
    surface:
      'border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-background to-background dark:from-cyan-500/14',
    switchFrame: 'border-cyan-500/20 bg-cyan-500/10',
  },
  slate: {
    accent: 'from-slate-500 via-slate-400 to-transparent',
    badge: 'border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300',
    glow: 'bg-slate-500/18 dark:bg-slate-500/22',
    surface:
      'border-slate-400/30 bg-gradient-to-br from-slate-500/8 via-background to-background dark:from-slate-500/12',
    switchFrame: 'border-slate-400/20 bg-slate-500/10',
  },
} as const;

function getStatusToneStyles(tone: ProviderCardProps['statusTone']) {
  switch (tone) {
    case 'ready':
      return {
        chip: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
        dot: 'bg-emerald-500',
      };
    case 'setup':
      return {
        chip: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200',
        dot: 'bg-amber-500',
      };
    case 'idle':
      return {
        chip: 'border-border/80 bg-muted/60 text-muted-foreground',
        dot: 'bg-muted-foreground/70',
      };
  }
}

export function ProviderCard({
  title,
  description,
  detail,
  badge,
  badgeTone,
  statusLabel,
  statusTone,
  enabled,
  saving,
  onToggle,
  fields = [],
  docsUrl,
  installCommand,
  footerNote,
  children,
}: ProviderCardProps) {
  const tone = PROVIDER_TONE_STYLES[badgeTone];
  const status = getStatusToneStyles(statusTone);

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border px-4 py-4 shadow-sm transition-all duration-200',
        enabled
          ? tone.surface
          : 'border-border/70 bg-gradient-to-br from-background via-background to-muted/25',
        enabled && 'shadow-[0_18px_40px_-28px_rgba(15,23,42,0.55)]'
      )}
    >
      <div className={cn('absolute inset-x-0 top-0 h-px bg-gradient-to-r', tone.accent)} />
      <div
        className={cn(
          'pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full blur-3xl',
          tone.glow
        )}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '22px 22px',
        }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="text-sm font-semibold tracking-tight">{title}</p>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]',
                tone.badge
              )}
            >
              {badge}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                status.chip
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
              {statusLabel}
            </span>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm leading-6 text-foreground/90">{description}</p>
            {detail && <p className="text-xs leading-5 text-muted-foreground">{detail}</p>}
          </div>
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background/75 backdrop-blur-sm',
            enabled ? tone.switchFrame : 'border-border/70'
          )}
        >
          <Switch checked={enabled} onCheckedChange={onToggle} disabled={saving} />
        </div>
      </div>

      {enabled && fields.length > 0 && (
        <div className="relative mt-4 rounded-xl border border-border/65 bg-background/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-sm">
          <div className="grid gap-3 md:grid-cols-2">
            {fields.map((field) => (
              <div key={field.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label
                    htmlFor={field.id}
                    className="text-[11px] font-medium text-muted-foreground"
                  >
                    {field.label}
                  </Label>
                  {field.saved && (
                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      Saved
                    </span>
                  )}
                </div>
                <Input
                  id={field.id}
                  value={field.value}
                  type={field.type ?? 'text'}
                  placeholder={field.placeholder}
                  onBlur={field.onBlur}
                  onChange={(event) => field.onChange(event.target.value)}
                  onKeyDown={field.onKeyDown}
                  className="h-8 border-border/70 bg-background/80 text-sm"
                  disabled={saving}
                />
                {field.helpText && (
                  <p className="text-[11px] text-muted-foreground">{field.helpText}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {enabled && children && (
        <div className="relative mt-4 rounded-xl border border-border/65 bg-background/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-sm">
          {children}
        </div>
      )}

      {(footerNote || installCommand || docsUrl) && (
        <div className="relative mt-4 space-y-2 rounded-xl border border-border/65 bg-muted/30 p-3">
          {footerNote && <p className="text-xs text-muted-foreground">{footerNote}</p>}
          {installCommand && (
            <code className="block rounded-lg border border-border/60 bg-background/85 px-2.5 py-2 text-[11px] text-muted-foreground">
              {installCommand}
            </code>
          )}
          {docsUrl && (
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              View docs
            </a>
          )}
        </div>
      )}
    </div>
  );
}
