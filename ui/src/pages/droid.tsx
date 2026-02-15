import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Wrench, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  useDroidConfig,
  useDroidDoctor,
  useDroidStatus,
  useUpdateDroidConfig,
} from '@/hooks/use-droid';

function CheckRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: boolean | null;
  detail: string;
}) {
  const resolvedStatus = status === true ? 'ok' : status === false ? 'fail' : 'unknown';

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-1">{detail}</p>
      </div>
      <div className="mt-0.5">
        {resolvedStatus === 'ok' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : resolvedStatus === 'fail' ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : (
          <Wrench className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

export function DroidPage() {
  const statusQuery = useDroidStatus();
  const configQuery = useDroidConfig();
  const doctorQuery = useDroidDoctor();
  const updateMutation = useUpdateDroidConfig();

  const [draft, setDraft] = useState<{ profile?: string; endpoint?: string }>({});
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const profile = draft.profile ?? configQuery.data?.profile ?? '';
  const endpoint = draft.endpoint ?? configQuery.data?.endpoint ?? '';

  const statusChecks = useMemo(() => {
    const health = doctorQuery.data ?? statusQuery.data;
    if (!health) {
      return [];
    }

    return [
      {
        label: 'Directory',
        status: health.checks.directoryExists,
        detail: health.checks.directoryExists
          ? 'Droid directory exists'
          : 'Droid directory missing',
      },
      {
        label: 'Config',
        status: health.checks.configExists,
        detail: health.checks.configExists ? 'Config file exists' : 'Config file missing',
      },
      {
        label: 'Endpoint',
        status: health.checks.endpointReachable,
        detail: health.details.endpointMessage,
      },
      {
        label: 'API Key',
        status: health.checks.apiKeyValid,
        detail: health.details.apiKeyMessage,
      },
      {
        label: 'Models',
        status: health.checks.modelsAvailable,
        detail: health.details.modelsMessage,
      },
    ];
  }, [doctorQuery.data, statusQuery.data]);

  const isSaving = updateMutation.isPending;
  const isLoading = statusQuery.isLoading || configQuery.isLoading;

  const refreshAll = () => {
    void statusQuery.refetch();
    void configQuery.refetch();
    void doctorQuery.refetch();
  };

  const saveConfig = async () => {
    try {
      const payload: {
        profile: string;
        endpoint: string;
        apiKey?: string;
        clearApiKey?: boolean;
      } = {
        profile: profile.trim(),
        endpoint: endpoint.trim(),
      };

      if (clearApiKey) {
        payload.clearApiKey = true;
      } else if (apiKey.trim().length > 0) {
        payload.apiKey = apiKey.trim();
      }

      await updateMutation.mutateAsync(payload);
      setDraft({});
      setApiKey('');
      setClearApiKey(false);
      toast.success('Droid configuration saved');
    } catch (error) {
      toast.error((error as Error).message || 'Failed to save Droid configuration');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[280px] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusError = (statusQuery.error as Error | null) ?? (configQuery.error as Error | null);
  const doctorError = doctorQuery.error as Error | null;

  if (statusError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-5 space-y-2">
          <p className="font-medium text-red-700 dark:text-red-300">Failed to load Droid status</p>
          <p className="text-sm text-red-700/90 dark:text-red-200/90">{statusError.message}</p>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const healthy = doctorQuery.data?.healthy ?? statusQuery.data?.healthy ?? false;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-5">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Factory Droid</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure and verify Droid endpoint integration for `ccs tool droid`.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Health</p>
            <p
              className={cn(
                'mt-1 text-sm font-medium',
                healthy ? 'text-emerald-500' : 'text-red-500'
              )}
            >
              {healthy ? 'Healthy' : 'Needs attention'}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Profile</p>
            <p className="mt-1 text-sm font-medium">{configQuery.data?.profile || 'droid'}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">API Key</p>
            <p className="mt-1 text-sm font-medium">
              {configQuery.data?.apiKeyConfigured ? 'Configured' : 'Not configured'}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Doctor Checks
        </h2>
        {doctorError ? (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-800 dark:text-yellow-200">
            Doctor endpoint unavailable: {doctorError.message}
          </div>
        ) : null}
        <div className="grid gap-3">
          {statusChecks.map((check) => (
            <CheckRow key={check.label} {...check} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Configuration
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="droid-profile">Profile</Label>
            <Input
              id="droid-profile"
              value={profile}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, profile: event.target.value }))
              }
              placeholder="droid"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="droid-endpoint">Endpoint</Label>
            <Input
              id="droid-endpoint"
              value={endpoint}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, endpoint: event.target.value }))
              }
              placeholder="http://127.0.0.1:4317"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="droid-api-key">API Key (optional)</Label>
          <Input
            id="droid-api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste new API key to rotate"
            type="password"
          />
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.target.checked)}
            />
            Clear stored API key
          </label>
        </div>

        <div className="flex justify-end">
          <Button onClick={saveConfig} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
