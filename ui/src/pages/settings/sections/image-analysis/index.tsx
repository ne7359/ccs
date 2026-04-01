import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api, type ImageAnalysisDashboardData } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useRawConfig } from '../../hooks';

interface MappingDraft {
  id: string;
  profileName: string;
  backendId: string;
}

type ImageBackend = ImageAnalysisDashboardData['backends'][number];
type ImageProfile = ImageAnalysisDashboardData['profiles'][number];

const NO_BACKEND = '__no_backend__';

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function isImageAnalysisDashboardData(value: unknown): value is ImageAnalysisDashboardData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ImageAnalysisDashboardData>;
  return (
    !!candidate.config &&
    typeof candidate.config.enabled === 'boolean' &&
    typeof candidate.config.timeout === 'number' &&
    isStringRecord(candidate.config.providerModels) &&
    (candidate.config.fallbackBackend === null ||
      typeof candidate.config.fallbackBackend === 'string') &&
    isStringRecord(candidate.config.profileBackends) &&
    !!candidate.summary &&
    typeof candidate.summary.state === 'string' &&
    typeof candidate.summary.title === 'string' &&
    typeof candidate.summary.detail === 'string' &&
    Array.isArray(candidate.backends) &&
    Array.isArray(candidate.profiles) &&
    !!candidate.catalog &&
    Array.isArray(candidate.catalog.knownBackends) &&
    Array.isArray(candidate.catalog.profileNames) &&
    typeof candidate.summary.nativeProfileCount === 'number'
  );
}

function toMappingDrafts(profileBackends: Record<string, string>): MappingDraft[] {
  return Object.entries(profileBackends)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([profileName, backendId], index) => ({
      id: `${profileName}-${backendId}-${index}`,
      profileName,
      backendId,
    }));
}

function summaryToneClass(state: ImageAnalysisDashboardData['summary']['state']): string {
  switch (state) {
    case 'ready':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200';
    case 'partial':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-200';
    case 'needs_setup':
      return 'border-rose-500/25 bg-rose-500/10 text-rose-900 dark:text-rose-200';
    case 'disabled':
      return 'border-border/80 bg-background/85 text-muted-foreground';
  }
}

function backendStateClass(state: ImageAnalysisDashboardData['backends'][number]['state']): string {
  switch (state) {
    case 'ready':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200';
    case 'starts_on_launch':
      return 'border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-200';
    case 'needs_auth':
      return 'border-rose-500/25 bg-rose-500/10 text-rose-800 dark:text-rose-200';
    case 'needs_proxy':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200';
    case 'review':
      return 'border-border/80 bg-background/85 text-muted-foreground';
  }
}

function currentTargetModeLabel(
  mode: ImageAnalysisDashboardData['profiles'][number]['currentTargetMode']
): string {
  switch (mode) {
    case 'active':
      return 'Active';
    case 'bypassed':
      return 'Bypassed';
    case 'fallback':
      return 'Native fallback';
    case 'setup':
      return 'Needs setup';
    case 'disabled':
      return 'Disabled';
    case 'native':
      return 'Native';
    case 'unresolved':
      return 'Native only';
  }
}

function currentTargetModeClass(
  mode: ImageAnalysisDashboardData['profiles'][number]['currentTargetMode']
): string {
  switch (mode) {
    case 'active':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200';
    case 'bypassed':
      return 'border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-200';
    case 'fallback':
    case 'setup':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200';
    case 'native':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200';
    case 'disabled':
    case 'unresolved':
      return 'border-border/80 bg-background/85 text-muted-foreground';
  }
}

function backendStateLabel(state: ImageBackend['state']): string {
  switch (state) {
    case 'starts_on_launch':
      return 'Starts on launch';
    case 'needs_auth':
      return 'Needs auth';
    case 'needs_proxy':
      return 'Needs proxy';
    case 'review':
      return 'Review';
    case 'ready':
      return 'Ready';
  }
}

function backendStatusNote(backend: ImageBackend | undefined): string | null {
  if (!backend) {
    return 'No model configured.';
  }

  switch (backend.state) {
    case 'needs_auth':
      return backend.authReason || 'Authenticate to route here.';
    case 'needs_proxy':
      return backend.proxyReason || 'Proxy unavailable.';
    case 'starts_on_launch':
      return 'Auth ready. Launches locally on demand.';
    case 'review':
      return 'Needs manual review.';
    case 'ready':
      return null;
  }
}

function routeSourceLabel(source: ImageProfile['resolutionSource']): string {
  switch (source) {
    case 'profile-backend':
      return 'Explicit mapping';
    case 'fallback-backend':
      return 'Fallback backend';
    case 'cliproxy-provider':
      return 'Provider match';
    case 'cliproxy-bridge':
      return 'Bridge match';
    case 'native-compatible':
      return 'Native path';
    case 'copilot-alias':
      return 'Copilot alias';
    default:
      return source.replace(/-/g, ' ');
  }
}

type SectionTone = 'sky' | 'amber' | 'emerald' | 'cyan' | 'slate';

function getSectionShellClass(tone: SectionTone): string {
  switch (tone) {
    case 'sky':
      return 'border-sky-500/20 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_45%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.88))]';
    case 'amber':
      return 'border-amber-500/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_44%),linear-gradient(180deg,rgba(255,251,235,0.96),rgba(255,247,237,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_44%),linear-gradient(180deg,rgba(35,26,17,0.96),rgba(28,22,17,0.92))]';
    case 'emerald':
      return 'border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_46%),linear-gradient(180deg,rgba(236,253,245,0.96),rgba(240,253,250,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_46%),linear-gradient(180deg,rgba(16,32,28,0.96),rgba(15,28,25,0.92))]';
    case 'cyan':
      return 'border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.14),transparent_44%),linear-gradient(180deg,rgba(236,254,255,0.96),rgba(240,249,255,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_44%),linear-gradient(180deg,rgba(13,28,34,0.96),rgba(15,25,32,0.92))]';
    case 'slate':
      return 'border-slate-400/20 bg-[radial-gradient(circle_at_top_right,rgba(148,163,184,0.14),transparent_44%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.96))] dark:bg-[radial-gradient(circle_at_top_right,rgba(148,163,184,0.16),transparent_44%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(17,24,39,0.96))]';
  }
}

function getSectionRuleClass(tone: SectionTone): string {
  switch (tone) {
    case 'sky':
      return 'from-sky-500/60 via-sky-500/15';
    case 'amber':
      return 'from-amber-500/60 via-amber-500/15';
    case 'emerald':
      return 'from-emerald-500/60 via-emerald-500/15';
    case 'cyan':
      return 'from-cyan-500/60 via-cyan-500/15';
    case 'slate':
      return 'from-slate-400/55 via-slate-400/15';
  }
}

function getSectionIconClass(tone: SectionTone): string {
  switch (tone) {
    case 'sky':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300';
    case 'amber':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'emerald':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'cyan':
      return 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300';
    case 'slate':
      return 'border-slate-400/25 bg-slate-500/10 text-slate-700 dark:text-slate-300';
  }
}

function getSectionEyebrowClass(tone: SectionTone): string {
  switch (tone) {
    case 'sky':
      return 'text-sky-700/80 dark:text-sky-300/80';
    case 'amber':
      return 'text-amber-700/80 dark:text-amber-300/80';
    case 'emerald':
      return 'text-emerald-700/80 dark:text-emerald-300/80';
    case 'cyan':
      return 'text-cyan-700/80 dark:text-cyan-300/80';
    case 'slate':
      return 'text-slate-600/80 dark:text-slate-300/80';
  }
}

function getInsetPanelClass(tone: SectionTone): string {
  switch (tone) {
    case 'sky':
      return 'border-sky-500/15 bg-background/75';
    case 'amber':
      return 'border-amber-500/15 bg-background/80';
    case 'emerald':
      return 'border-emerald-500/15 bg-background/78';
    case 'cyan':
      return 'border-cyan-500/15 bg-background/78';
    case 'slate':
      return 'border-slate-400/15 bg-background/78';
  }
}

function getBackendRowClass(state: ImageBackend['state'] | undefined): string {
  switch (state) {
    case 'ready':
      return 'bg-[linear-gradient(90deg,rgba(16,185,129,0.08),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.46))] dark:bg-[linear-gradient(90deg,rgba(16,185,129,0.12),transparent_18%),linear-gradient(180deg,rgba(15,23,42,0.82),rgba(15,23,42,0.56))]';
    case 'starts_on_launch':
      return 'bg-[linear-gradient(90deg,rgba(14,165,233,0.08),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.46))] dark:bg-[linear-gradient(90deg,rgba(14,165,233,0.12),transparent_18%),linear-gradient(180deg,rgba(15,23,42,0.82),rgba(15,23,42,0.56))]';
    case 'needs_auth':
      return 'bg-[linear-gradient(90deg,rgba(244,63,94,0.08),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.46))] dark:bg-[linear-gradient(90deg,rgba(244,63,94,0.12),transparent_18%),linear-gradient(180deg,rgba(15,23,42,0.82),rgba(15,23,42,0.56))]';
    case 'needs_proxy':
      return 'bg-[linear-gradient(90deg,rgba(245,158,11,0.08),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.46))] dark:bg-[linear-gradient(90deg,rgba(245,158,11,0.12),transparent_18%),linear-gradient(180deg,rgba(15,23,42,0.82),rgba(15,23,42,0.56))]';
    case 'review':
    default:
      return 'bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(255,255,255,0.5))] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.8),rgba(15,23,42,0.58))]';
  }
}

function getBackendRailClass(state: ImageBackend['state'] | undefined): string {
  switch (state) {
    case 'ready':
      return 'from-emerald-500 to-emerald-400/30';
    case 'starts_on_launch':
      return 'from-sky-500 to-sky-400/30';
    case 'needs_auth':
      return 'from-rose-500 to-rose-400/30';
    case 'needs_proxy':
      return 'from-amber-500 to-amber-400/30';
    case 'review':
    default:
      return 'from-slate-400 to-slate-300/20';
  }
}

function getCoverageRowClass(index: number, profile: ImageProfile): string {
  if (profile.nativeReadPreference) {
    return index % 2 === 0 ? 'bg-emerald-500/[0.06]' : 'bg-emerald-500/[0.08]';
  }

  return index % 2 === 0 ? 'bg-background/75' : 'bg-muted/18';
}

function summaryCompactDetail(summary: ImageAnalysisDashboardData['summary']): string {
  const parts = [`${summary.activeProfileCount} routed`, `${summary.nativeProfileCount} native`];

  if (summary.mappedProfileCount > 0) {
    parts.push(
      `${summary.mappedProfileCount} override${summary.mappedProfileCount === 1 ? '' : 's'}`
    );
  }

  return parts.join(' · ');
}

function buildProviderModelsPayload(
  providerModels: Record<string, string>
): Record<string, string | null> {
  return Object.entries(providerModels).reduce(
    (acc, [backendId, model]) => {
      const normalizedModel = model.trim();
      acc[backendId] = normalizedModel || null;
      return acc;
    },
    {} as Record<string, string | null>
  );
}

function getConfiguredBackendIds(providerModels: Record<string, string>): string[] {
  return Object.entries(providerModels)
    .filter(([, model]) => model.trim().length > 0)
    .map(([backendId]) => backendId);
}

function buildProfileBackends(mappingDrafts: MappingDraft[]): Record<string, string> {
  return mappingDrafts.reduce(
    (acc, row) => {
      const profileName = row.profileName.trim();
      if (!profileName || !row.backendId) {
        return acc;
      }

      acc[profileName] = row.backendId;
      return acc;
    },
    {} as Record<string, string>
  );
}

function normalizeTimeoutDraft(rawValue: string, fallbackValue: string): string {
  const parsed = Number.parseInt(rawValue.trim(), 10);
  if (!Number.isInteger(parsed)) {
    return fallbackValue;
  }

  return String(Math.min(600, Math.max(10, parsed)));
}

interface ImageSectionPanelProps {
  tone: SectionTone;
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

function ImageSectionPanel({
  tone,
  eyebrow,
  title,
  description,
  icon,
  meta,
  action,
  children,
  className,
}: ImageSectionPanelProps) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-[24px] border p-4 shadow-sm',
        getSectionShellClass(tone),
        className
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent',
          getSectionRuleClass(tone)
        )}
      />
      <div className="pointer-events-none absolute -right-12 top-0 h-28 w-28 rounded-full bg-white/35 blur-3xl dark:bg-white/6" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2.5">
            <div
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                getSectionIconClass(tone)
              )}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <div
                className={cn(
                  'text-[10px] font-semibold uppercase tracking-[0.16em]',
                  getSectionEyebrowClass(tone)
                )}
              >
                {eyebrow}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{title}</h3>
                {meta}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>

        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function ImageAnalysisSection() {
  const { fetchRawConfig } = useRawConfig();
  const [data, setData] = useState<ImageAnalysisDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showProfileRouting, setShowProfileRouting] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [timeout, setTimeout] = useState('60');
  const [fallbackBackend, setFallbackBackend] = useState('');
  const [providerModels, setProviderModels] = useState<Record<string, string>>({});
  const [mappingDrafts, setMappingDrafts] = useState<MappingDraft[]>([]);

  const hydrateDraft = useCallback((nextData: ImageAnalysisDashboardData) => {
    setEnabled(nextData.config.enabled);
    setTimeout(String(nextData.config.timeout));
    setFallbackBackend(nextData.config.fallbackBackend ?? '');
    setProviderModels(
      nextData.catalog.knownBackends.reduce(
        (acc, backendId) => {
          acc[backendId] = nextData.config.providerModels[backendId] ?? '';
          return acc;
        },
        {} as Record<string, string>
      )
    );
    setMappingDrafts(toMappingDrafts(nextData.config.profileBackends));
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = await api.imageAnalysis.get();
      if (!isImageAnalysisDashboardData(payload)) {
        throw new Error(
          'Image settings returned an unexpected response. Restart the dashboard server so the new API route is available.'
        );
      }
      setData(payload);
      hydrateDraft(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load image settings.');
    } finally {
      setLoading(false);
    }
  }, [hydrateDraft]);

  useEffect(() => {
    void fetchData();
    void fetchRawConfig();
  }, [fetchData, fetchRawConfig]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 2500);
    return () => window.clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    if (!data) return;
    if (Object.keys(data.config.profileBackends).length > 0) {
      setShowProfileRouting(true);
    }
  }, [data]);

  const configuredBackendIds = useMemo(
    () => getConfiguredBackendIds(providerModels),
    [providerModels]
  );

  const orderedBackendIds = useMemo(() => {
    if (!data) return [];

    const configured = data.catalog.knownBackends.filter((backendId) =>
      configuredBackendIds.includes(backendId)
    );
    const inactive = data.catalog.knownBackends.filter(
      (backendId) => !configuredBackendIds.includes(backendId)
    );

    return [...configured, ...inactive];
  }, [configuredBackendIds, data]);

  const nativeReadProfiles = useMemo(
    () => data?.profiles.filter((profile) => profile.nativeReadPreference) ?? [],
    [data]
  );

  useEffect(() => {
    if (configuredBackendIds.length === 0) {
      setFallbackBackend('');
      return;
    }
    if (!configuredBackendIds.includes(fallbackBackend)) {
      setFallbackBackend(configuredBackendIds[0]);
    }
  }, [configuredBackendIds, fallbackBackend]);

  const persistSettings = useCallback(
    async (overrides?: {
      enabled?: boolean;
      timeout?: string;
      fallbackBackend?: string;
      providerModels?: Record<string, string>;
      mappingDrafts?: MappingDraft[];
    }) => {
      if (!data) return false;

      const nextEnabled = overrides?.enabled ?? enabled;
      const nextProviderModels = overrides?.providerModels ?? providerModels;
      const nextConfiguredBackendIds = getConfiguredBackendIds(nextProviderModels);
      const nextTimeout = normalizeTimeoutDraft(
        overrides?.timeout ?? timeout,
        String(data.config.timeout)
      );
      const requestedFallbackBackend = overrides?.fallbackBackend ?? fallbackBackend;
      const nextFallbackBackend =
        nextConfiguredBackendIds.length === 0
          ? ''
          : nextConfiguredBackendIds.includes(requestedFallbackBackend)
            ? requestedFallbackBackend
            : nextConfiguredBackendIds[0];
      const nextMappingDrafts = overrides?.mappingDrafts ?? mappingDrafts;
      const nextPayload = {
        enabled: nextEnabled,
        timeout: nextTimeout,
        fallbackBackend: nextFallbackBackend,
        providerModels: buildProviderModelsPayload(nextProviderModels),
        profileBackends: buildProfileBackends(nextMappingDrafts),
      };

      const currentPayload = {
        enabled: data.config.enabled,
        timeout: String(data.config.timeout),
        fallbackBackend: data.config.fallbackBackend ?? '',
        providerModels: data.catalog.knownBackends.reduce(
          (acc, backendId) => {
            acc[backendId] = data.config.providerModels[backendId] ?? null;
            return acc;
          },
          {} as Record<string, string | null>
        ),
        profileBackends: data.config.profileBackends,
      };

      if (JSON.stringify(nextPayload) === JSON.stringify(currentPayload)) {
        return true;
      }

      if (nextEnabled && nextConfiguredBackendIds.length === 0) {
        setError('Keep at least one provider model configured, or disable Image globally.');
        hydrateDraft(data);
        return false;
      }

      try {
        setSaving(true);
        setError(null);
        const payload = await api.imageAnalysis.update({
          enabled: nextEnabled,
          timeout: Number.parseInt(nextTimeout, 10),
          fallbackBackend: nextFallbackBackend || null,
          providerModels: nextPayload.providerModels,
          profileBackends: nextPayload.profileBackends,
        });
        setData(payload);
        hydrateDraft(payload);
        setSuccess('Image settings saved.');
        await fetchRawConfig();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save image settings.');
        hydrateDraft(data);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [
      data,
      enabled,
      fallbackBackend,
      fetchRawConfig,
      hydrateDraft,
      mappingDrafts,
      providerModels,
      timeout,
    ]
  );

  const handleRefresh = async () => {
    if (loading || saving) return;
    setSuccess(null);
    await Promise.all([fetchData(), fetchRawConfig()]);
  };

  const handleEnabledChange = async (nextEnabled: boolean) => {
    if (saving) return;
    if (nextEnabled && configuredBackendIds.length === 0) {
      setError('Keep at least one provider model configured, or disable Image globally.');
      return;
    }

    setEnabled(nextEnabled);
    await persistSettings({ enabled: nextEnabled });
  };

  const commitTimeout = async (nextValue: string) => {
    if (!data || saving) return;
    const normalizedTimeout = normalizeTimeoutDraft(nextValue, String(data.config.timeout));
    setTimeout(normalizedTimeout);
    await persistSettings({ timeout: normalizedTimeout });
  };

  const commitFallbackBackend = async (nextFallbackBackend: string) => {
    if (saving) return;
    setFallbackBackend(nextFallbackBackend);
    await persistSettings({ fallbackBackend: nextFallbackBackend });
  };

  const commitProviderModel = async (backendId: string, nextValue: string) => {
    if (!data || saving) return;

    const normalizedValue = nextValue.trim();
    const nextProviderModels = {
      ...providerModels,
      [backendId]: normalizedValue,
    };
    const nextConfiguredBackendIds = getConfiguredBackendIds(nextProviderModels);

    if (enabled && nextConfiguredBackendIds.length === 0) {
      setError('Disable Image first or keep one backend configured.');
      setProviderModels((current) => ({
        ...current,
        [backendId]: data.config.providerModels[backendId] ?? '',
      }));
      return;
    }

    const nextFallbackBackend =
      nextConfiguredBackendIds.length === 0
        ? ''
        : nextConfiguredBackendIds.includes(fallbackBackend)
          ? fallbackBackend
          : nextConfiguredBackendIds[0];

    setProviderModels(nextProviderModels);
    setFallbackBackend(nextFallbackBackend);
    await persistSettings({
      providerModels: nextProviderModels,
      fallbackBackend: nextFallbackBackend,
    });
  };

  const updateMappingRow = (rowId: string, patch: Partial<MappingDraft>) => {
    setMappingDrafts((current) =>
      current.map((entry) => (entry.id === rowId ? { ...entry, ...patch } : entry))
    );
  };

  const commitMappingDrafts = async (nextMappingDrafts: MappingDraft[]) => {
    if (saving) return;
    setMappingDrafts(nextMappingDrafts);
    await persistSettings({ mappingDrafts: nextMappingDrafts });
  };

  const completeMappingCount = mappingDrafts.filter(
    (row) => row.profileName.trim() && row.backendId
  ).length;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading image settings...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-5">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error ?? 'Failed to load image settings.'}</AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="relative isolate overflow-hidden p-4 md:p-5">
        <div className="pointer-events-none absolute -top-20 left-8 h-48 w-48 rounded-full bg-sky-500/10 blur-3xl dark:bg-sky-500/12" />
        <div className="pointer-events-none absolute right-4 top-[28rem] h-52 w-52 rounded-full bg-emerald-500/10 blur-3xl dark:bg-emerald-500/12" />
        <div className="pointer-events-none absolute bottom-20 left-12 h-44 w-44 rounded-full bg-amber-500/10 blur-3xl dark:bg-amber-500/10" />

        <div className="relative z-10 space-y-4">
          {(error || success) && (
            <div className="space-y-2">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {success && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">{success}</span>
                </div>
              )}
            </div>
          )}

          <section className="relative overflow-hidden rounded-[24px] border border-sky-500/20 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_44%),linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.92))] p-4 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_44%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.88))]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-sky-500/50 via-sky-500/10 to-transparent" />
            <div className="pointer-events-none absolute -right-8 top-0 h-24 w-24 rounded-full bg-white/35 blur-3xl dark:bg-white/6" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-2.5">
                <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300">
                  <ImageIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700/80 dark:text-sky-300/80">
                    Image control plane
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold tracking-tight">Image</h2>
                    <Badge className={cn('border', summaryToneClass(data.summary.state))}>
                      {data.summary.title}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {summaryCompactDetail(data.summary)}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={loading || saving}
                className="h-9 self-start rounded-xl border-sky-500/15 bg-background/72 backdrop-blur-sm"
              >
                <RefreshCw className={cn('mr-1 h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-[18px] border bg-background/72 px-3 py-2.5 backdrop-blur-sm">
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Active routes
                </div>
                <div className="mt-1.5 text-xl font-semibold text-foreground">
                  {data.summary.activeProfileCount}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Current target path</p>
              </div>
              <div className="rounded-[18px] border bg-background/72 px-3 py-2.5 backdrop-blur-sm">
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Native path
                </div>
                <div className="mt-1.5 text-xl font-semibold text-foreground">
                  {data.summary.nativeProfileCount}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Skip transformer</p>
              </div>
            </div>
          </section>

          <ImageSectionPanel
            tone="amber"
            eyebrow="Control deck"
            title="Core setup"
            description="Global toggle, timeout, and fallback."
            icon={<SlidersHorizontal className="h-4 w-4" />}
            meta={
              <Badge variant="outline" className="border-amber-500/25 bg-amber-500/10 text-[10px]">
                {configuredBackendIds.length} configured
              </Badge>
            }
          >
            <div className="grid gap-2 lg:grid-cols-3">
              <div
                className={cn(
                  'rounded-[18px] border px-3.5 py-3 shadow-sm',
                  getInsetPanelClass('amber')
                )}
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700/75 dark:text-amber-300/75">
                  Enabled
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold text-foreground">
                      {enabled ? 'Transformer on' : 'Transformer off'}
                    </div>
                    <p className="text-[11px] leading-4 text-muted-foreground">
                      Profile flags stay untouched.
                    </p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => {
                      void handleEnabledChange(checked);
                    }}
                    disabled={saving}
                  />
                </div>
              </div>

              <div
                className={cn(
                  'rounded-[18px] border px-3.5 py-3 shadow-sm',
                  getInsetPanelClass('amber')
                )}
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700/75 dark:text-amber-300/75">
                  Timeout
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <Input
                    value={timeout}
                    onChange={(event) => setTimeout(event.target.value)}
                    inputMode="numeric"
                    className="h-10 border-amber-500/15 bg-background/90 text-base"
                    disabled={saving}
                    onBlur={(event) => {
                      void commitTimeout(event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <span className="text-xs font-medium text-muted-foreground">sec</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                  Keeps large reads from hanging.
                </p>
              </div>

              <div
                className={cn(
                  'rounded-[18px] border px-3.5 py-3 shadow-sm',
                  getInsetPanelClass('amber')
                )}
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700/75 dark:text-amber-300/75">
                  Fallback backend
                </div>
                <div className="mt-2.5">
                  <Select
                    value={fallbackBackend || NO_BACKEND}
                    onValueChange={(value) => {
                      void commitFallbackBackend(value === NO_BACKEND ? '' : value);
                    }}
                    disabled={saving}
                  >
                    <SelectTrigger className="h-10 border-amber-500/15 bg-background/90">
                      <SelectValue placeholder="Choose backend" />
                    </SelectTrigger>
                    <SelectContent>
                      {configuredBackendIds.length === 0 ? (
                        <SelectItem value={NO_BACKEND}>Configure a model first</SelectItem>
                      ) : (
                        configuredBackendIds.map((backendId) => (
                          <SelectItem key={backendId} value={backendId}>
                            {backendId}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                  Used when no direct route exists.
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <div className="rounded-full border border-amber-500/15 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
                {completeMappingCount} overrides
              </div>
              <div className="rounded-full border border-amber-500/15 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
                {nativeReadProfiles.length} native
              </div>
              <div className="rounded-full border border-amber-500/15 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
                {fallbackBackend || 'No fallback'} fallback
              </div>
            </div>
          </ImageSectionPanel>

          <ImageSectionPanel
            tone="cyan"
            eyebrow="Route inventory"
            title="Backend routes"
            description="Model entry plus route health."
            icon={<Activity className="h-4 w-4" />}
            meta={
              <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/10 text-[10px]">
                {orderedBackendIds.length} backends
              </Badge>
            }
          >
            <div className="overflow-hidden rounded-[20px] border border-cyan-500/12 bg-background/65 shadow-sm backdrop-blur-sm">
              {orderedBackendIds.map((backendId, index) => {
                const backendStatus = data.backends.find((item) => item.backendId === backendId);
                const displayName = backendStatus?.displayName || backendId;
                const currentModel = providerModels[backendId] ?? '';
                const statusNote = backendStatusNote(backendStatus);
                const usageLine = currentModel
                  ? [
                      `${backendStatus?.profilesUsing ?? 0} active`,
                      backendStatus?.authReadiness === 'missing'
                        ? 'auth missing'
                        : backendStatus?.proxyReadiness === 'stopped'
                          ? 'starts on launch'
                          : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'No model configured.';

                return (
                  <div
                    key={backendId}
                    className={cn(
                      'relative px-3 py-3 md:px-4',
                      index > 0 && 'border-t border-cyan-500/10',
                      getBackendRowClass(backendStatus?.state)
                    )}
                  >
                    <div
                      className={cn(
                        'absolute bottom-3 left-0 top-3 w-1 rounded-r-full bg-gradient-to-b',
                        getBackendRailClass(backendStatus?.state)
                      )}
                    />

                    <div className="pl-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-semibold text-foreground">{displayName}</h4>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {backendId}
                            </Badge>
                            {backendStatus?.profilesUsing ? (
                              <Badge
                                variant="outline"
                                className="border-cyan-500/20 bg-cyan-500/10 text-[10px]"
                              >
                                {backendStatus.profilesUsing} active
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                            {usageLine}
                          </p>
                        </div>
                        <Badge
                          className={cn(
                            'border',
                            backendStatus
                              ? backendStateClass(backendStatus.state)
                              : 'border-border/80 bg-background/85 text-muted-foreground'
                          )}
                        >
                          {backendStatus ? backendStateLabel(backendStatus.state) : 'Inactive'}
                        </Badge>
                      </div>

                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <Input
                          className="h-10 flex-1 border-cyan-500/15 bg-background/88 text-base"
                          placeholder="Set model"
                          value={currentModel}
                          disabled={saving}
                          onChange={(event) =>
                            setProviderModels((current) => ({
                              ...current,
                              [backendId]: event.target.value,
                            }))
                          }
                          onBlur={(event) => {
                            void commitProviderModel(backendId, event.currentTarget.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur();
                            }
                          }}
                        />
                        {currentModel.trim().length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-10 sm:self-stretch"
                            disabled={saving}
                            onClick={() => {
                              void commitProviderModel(backendId, '');
                            }}
                          >
                            Clear
                          </Button>
                        )}
                      </div>

                      {statusNote && (
                        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                          {statusNote}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ImageSectionPanel>

          <ImageSectionPanel
            tone="emerald"
            eyebrow="Native path"
            title="Native reading"
            description="Profiles that skip the transformer."
            icon={<Sparkles className="h-4 w-4" />}
            meta={<Badge variant="outline">{nativeReadProfiles.length} profiles</Badge>}
          >
            {nativeReadProfiles.length === 0 ? (
              <div
                className={cn(
                  'rounded-[18px] border border-dashed px-3.5 py-3.5 text-sm text-muted-foreground',
                  getInsetPanelClass('emerald')
                )}
              >
                No profiles prefer native reading yet.
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {nativeReadProfiles.map((profile) => (
                  <div
                    key={`native-${profile.kind}-${profile.name}`}
                    className={cn(
                      'rounded-[18px] border px-3.5 py-3 shadow-sm',
                      getInsetPanelClass('emerald')
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {profile.name}
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {profile.kind === 'variant' ? 'Variant' : 'Profile'}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {profile.nativeImageCapable ? 'Verified' : 'Review'}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                          {profile.profileModel || 'Model not detected'} ·{' '}
                          {profile.nativeImageReason || 'Native read preferred.'}
                        </div>
                      </div>
                      <Badge
                        className={cn('border', currentTargetModeClass(profile.currentTargetMode))}
                      >
                        {currentTargetModeLabel(profile.currentTargetMode)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ImageSectionPanel>

          <ImageSectionPanel
            tone="slate"
            eyebrow="Override lab"
            title="Profile routing"
            description="Only for explicit route overrides."
            icon={<GitBranch className="h-4 w-4" />}
            meta={
              <Badge
                variant="outline"
                className="border-amber-500/25 bg-amber-500/10 text-[10px] text-amber-800 dark:text-amber-200"
              >
                Advanced
              </Badge>
            }
            action={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowProfileRouting((current) => !current)}
                >
                  {showProfileRouting ? (
                    <ChevronUp className="mr-1 h-4 w-4" />
                  ) : (
                    <ChevronDown className="mr-1 h-4 w-4" />
                  )}
                  {showProfileRouting ? 'Hide' : 'Show'}
                </Button>
                {showProfileRouting && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setMappingDrafts((current) => [
                        ...current,
                        {
                          id: `mapping-${Date.now()}`,
                          profileName: '',
                          backendId: configuredBackendIds[0] ?? '',
                        },
                      ])
                    }
                    disabled={configuredBackendIds.length === 0 || saving}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add mapping
                  </Button>
                )}
              </div>
            }
            className="border-dashed"
          >
            <datalist id="image-profile-suggestions">
              {data.catalog.profileNames.map((profileName) => (
                <option key={profileName} value={profileName} />
              ))}
            </datalist>

            {showProfileRouting ? (
              <div className="space-y-2">
                {mappingDrafts.length === 0 ? (
                  <div
                    className={cn(
                      'rounded-[18px] border border-dashed px-3.5 py-3.5 text-sm text-muted-foreground',
                      getInsetPanelClass('slate')
                    )}
                  >
                    No explicit overrides saved.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mappingDrafts.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-[18px] border border-slate-400/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(248,250,252,0.52))] p-3 shadow-sm dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.84),rgba(15,23,42,0.56))]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-[11px] leading-4 text-muted-foreground">
                            <span>Direct override</span>
                            {!(row.profileName.trim() && row.backendId) && (
                              <Badge variant="outline" className="text-[10px]">
                                Draft
                              </Badge>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={saving}
                            onClick={() => {
                              const nextMappingDrafts = mappingDrafts.filter(
                                (entry) => entry.id !== row.id
                              );
                              void commitMappingDrafts(nextMappingDrafts);
                            }}
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            Remove
                          </Button>
                        </div>

                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <Input
                            value={row.profileName}
                            list="image-profile-suggestions"
                            disabled={saving}
                            placeholder="Profile or variant name"
                            className="h-10 border-slate-400/15 bg-background/88 text-base"
                            onChange={(event) => {
                              updateMappingRow(row.id, { profileName: event.target.value });
                            }}
                            onBlur={(event) => {
                              const nextMappingDrafts = mappingDrafts.map((entry) =>
                                entry.id === row.id
                                  ? { ...entry, profileName: event.currentTarget.value.trim() }
                                  : entry
                              );
                              void commitMappingDrafts(nextMappingDrafts);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.currentTarget.blur();
                              }
                            }}
                          />
                          <Select
                            value={row.backendId || NO_BACKEND}
                            disabled={saving}
                            onValueChange={(value) => {
                              const nextMappingDrafts = mappingDrafts.map((entry) =>
                                entry.id === row.id
                                  ? { ...entry, backendId: value === NO_BACKEND ? '' : value }
                                  : entry
                              );
                              void commitMappingDrafts(nextMappingDrafts);
                            }}
                          >
                            <SelectTrigger className="h-10 border-slate-400/15 bg-background/88">
                              <SelectValue placeholder="Choose backend" />
                            </SelectTrigger>
                            <SelectContent>
                              {configuredBackendIds.length === 0 ? (
                                <SelectItem value={NO_BACKEND}>Configure a model first</SelectItem>
                              ) : (
                                configuredBackendIds.map((backendId) => (
                                  <SelectItem key={backendId} value={backendId}>
                                    {backendId}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div
                className={cn(
                  'rounded-[18px] border border-dashed px-3.5 py-3 text-sm text-muted-foreground',
                  getInsetPanelClass('slate')
                )}
              >
                Hidden by default.
                {mappingDrafts.length > 0
                  ? ` ${mappingDrafts.length} override${mappingDrafts.length === 1 ? '' : 's'} saved.`
                  : ' No overrides saved.'}
              </div>
            )}
          </ImageSectionPanel>

          <ImageSectionPanel
            tone="slate"
            eyebrow="Audit view"
            title="Coverage"
            description="Read-only routing ledger for the current path."
            icon={<ImageIcon className="h-4 w-4" />}
            meta={<Badge variant="outline">{data.profiles.length} profiles</Badge>}
          >
            <div className="overflow-hidden rounded-[20px] border border-slate-400/15 bg-background/75 shadow-sm backdrop-blur-sm">
              {data.profiles.map((profile, index) => (
                <div
                  key={`${profile.kind}-${profile.name}`}
                  className={cn(
                    'grid gap-2 px-3.5 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
                    index > 0 && 'border-t border-slate-400/12',
                    getCoverageRowClass(index, profile)
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {profile.name}
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {profile.kind === 'variant' ? 'Variant' : 'Profile'}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[10px] uppercase">
                        {profile.target}
                      </Badge>
                      {profile.nativeReadPreference && (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/20 bg-emerald-500/10 text-[10px]"
                        >
                          Native
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                      {profile.backendDisplayName || profile.profileModel || 'Native file access'} ·{' '}
                      {routeSourceLabel(profile.resolutionSource)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 md:justify-end">
                    {profile.profileModel && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {profile.profileModel}
                      </Badge>
                    )}
                    <Badge
                      className={cn('border', currentTargetModeClass(profile.currentTargetMode))}
                    >
                      {currentTargetModeLabel(profile.currentTargetMode)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </ImageSectionPanel>
        </div>
      </div>
    </ScrollArea>
  );
}
