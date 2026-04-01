/**
 * Profile Editor Component
 * Inline editor for API profile settings with 2-column layout (Friendly UI + Raw JSON)
 */

/* eslint-disable react-refresh/only-export-components */
import { useState, useMemo, useCallback, useEffect, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Loader2, Code2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { HeaderSection } from './header-section';
import { FriendlyUISection } from './friendly-ui-section';
import { RawEditorSection } from './raw-editor-section';
import type { ProfileEditorProps, Settings, SettingsResponse } from './types';
import { api, type CliTarget } from '@/lib/api-client';
import i18n from '@/lib/i18n';

export function ProfileEditor({
  profileName,
  profileTarget,
  onDelete,
  onHasChangesUpdate,
}: ProfileEditorProps) {
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});
  const [conflictDialog, setConflictDialog] = useState(false);
  const [rawJsonEdits, setRawJsonEdits] = useState<string | null>(null);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const queryClient = useQueryClient();

  // Fetch settings for selected profile
  const { data, isLoading, isError, refetch } = useQuery<SettingsResponse>({
    queryKey: ['settings', profileName],
    queryFn: async () => {
      const res = await fetch(`/api/settings/${profileName}/raw`);
      if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
      return res.json();
    },
  });

  const settings = data?.settings;

  // Derive current settings by merging original data with local edits
  const currentSettings = useMemo((): Settings | undefined => {
    if (rawJsonEdits !== null) {
      try {
        return JSON.parse(rawJsonEdits);
      } catch {
        // Fall back to settings merge
      }
    }
    if (!settings) return undefined;
    return { ...settings, env: { ...settings.env, ...localEdits } };
  }, [settings, localEdits, rawJsonEdits]);

  // Compute raw JSON content
  const computedRawJsonContent = useMemo(() => {
    if (rawJsonEdits !== null) return rawJsonEdits;
    if (settings) return JSON.stringify(settings, null, 2);
    return '';
  }, [rawJsonEdits, settings]);

  const handleRawJsonChange = useCallback((value: string) => {
    setRawJsonEdits(value);
  }, []);

  const updateNativeImageRead = useCallback(
    (enabled: boolean) => {
      const nextSettings = { ...(currentSettings ?? {}) } as Settings;
      const currentCcsImage =
        nextSettings.ccs_image && typeof nextSettings.ccs_image === 'object'
          ? { ...nextSettings.ccs_image }
          : {};

      if (enabled) {
        currentCcsImage.native_read = true;
      } else {
        delete currentCcsImage.native_read;
      }

      if (Object.keys(currentCcsImage).length > 0) {
        nextSettings.ccs_image = currentCcsImage;
      } else {
        delete nextSettings.ccs_image;
      }

      setRawJsonEdits(JSON.stringify(nextSettings, null, 2));
    },
    [currentSettings]
  );

  // Sync Visual Editor changes to Raw JSON
  const updateEnvValue = (key: string, value: string) => {
    const newEnv = { ...(currentSettings?.env || {}), [key]: value };
    setLocalEdits((prev) => ({ ...prev, [key]: value }));
    setRawJsonEdits(JSON.stringify({ ...currentSettings, env: newEnv }, null, 2));
  };

  // Bulk update multiple env vars at once (avoids race conditions)
  const updateEnvBulk = (env: Record<string, string>) => {
    const newEnv = { ...(currentSettings?.env || {}), ...env };
    setLocalEdits((prev) => ({ ...prev, ...env }));
    setRawJsonEdits(JSON.stringify({ ...currentSettings, env: newEnv }, null, 2));
  };

  const addNewEnvVar = () => {
    if (!newEnvKey.trim()) return;
    const key = newEnvKey.trim();
    const value = newEnvValue;
    const newEnv = { ...(currentSettings?.env || {}), [key]: value };
    setLocalEdits((prev) => ({ ...prev, [key]: value }));
    setRawJsonEdits(JSON.stringify({ ...currentSettings, env: newEnv }, null, 2));
    setNewEnvKey('');
    setNewEnvValue('');
  };

  // Computed validity and changes check
  const computedIsRawJsonValid = useMemo(() => {
    try {
      JSON.parse(computedRawJsonContent);
      return true;
    } catch {
      return false;
    }
  }, [computedRawJsonContent]);

  const computedHasChanges = useMemo(() => {
    if (rawJsonEdits !== null) return rawJsonEdits !== JSON.stringify(settings, null, 2);
    return Object.keys(localEdits).length > 0;
  }, [rawJsonEdits, localEdits, settings]);

  const deferredPreviewJson = useDeferredValue(computedRawJsonContent);
  const previewSettings = useMemo((): Settings | null => {
    if (!computedHasChanges || !computedIsRawJsonValid) {
      return null;
    }

    try {
      return JSON.parse(deferredPreviewJson) as Settings;
    } catch {
      return null;
    }
  }, [computedHasChanges, computedIsRawJsonValid, deferredPreviewJson]);

  const {
    data: previewStatusResponse,
    isFetching: isPreviewStatusFetching,
    isError: isPreviewStatusError,
    isPlaceholderData: isPreviewStatusPlaceholderData,
  } = useQuery<{ imageAnalysisStatus: SettingsResponse['imageAnalysisStatus'] }>({
    queryKey: ['settings', profileName, 'image-analysis-status-preview', deferredPreviewJson],
    enabled: previewSettings !== null,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await fetch(`/api/settings/${profileName}/image-analysis-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: previewSettings }),
      });

      if (!res.ok) {
        throw new Error(`Failed to preview image-analysis status: ${res.status}`);
      }

      return res.json();
    },
  });

  const imageAnalysisStatus =
    computedHasChanges && computedIsRawJsonValid && !isPreviewStatusError
      ? (previewStatusResponse?.imageAnalysisStatus ?? data?.imageAnalysisStatus)
      : data?.imageAnalysisStatus;
  const imageAnalysisStatusSource =
    computedHasChanges &&
    computedIsRawJsonValid &&
    !isPreviewStatusError &&
    previewStatusResponse?.imageAnalysisStatus
      ? 'editor'
      : 'saved';
  const imageAnalysisStatusPreviewState = !computedHasChanges
    ? 'saved'
    : !computedIsRawJsonValid
      ? 'invalid'
      : isPreviewStatusError
        ? 'saved'
        : isPreviewStatusFetching &&
            (!previewStatusResponse?.imageAnalysisStatus || isPreviewStatusPlaceholderData)
          ? 'refreshing'
          : 'preview';
  const nativeReadPreferenceOverride = currentSettings?.ccs_image?.native_read === true;

  // Check for missing required fields (informational warning)
  const missingRequiredFields = useMemo(() => {
    const REQUIRED_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'] as const;
    const env = currentSettings?.env || {};
    return REQUIRED_ENV_KEYS.filter((key) => !env[key]?.trim());
  }, [currentSettings]);

  // Notify parent of hasChanges state
  useEffect(() => {
    onHasChangesUpdate?.(computedHasChanges);
  }, [computedHasChanges, onHasChangesUpdate]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      let settingsToSave: Settings;
      try {
        settingsToSave = JSON.parse(computedRawJsonContent);
      } catch {
        settingsToSave = { ...data?.settings, env: { ...data?.settings?.env, ...localEdits } };
      }

      const res = await fetch(`/api/settings/${profileName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsToSave, expectedMtime: data?.mtime }),
      });

      if (res.status === 409) throw new Error('CONFLICT');
      if (!res.ok) throw new Error('Failed to save');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', profileName] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      setLocalEdits({});
      setRawJsonEdits(null);
      toast.success(i18n.t('commonToast.settingsSaved'));
    },
    onError: (error: Error) => {
      if (error.message === 'CONFLICT') setConflictDialog(true);
      else toast.error(error.message);
    },
  });

  const targetMutation = useMutation<CliTarget, Error, CliTarget>({
    mutationFn: async (target: CliTarget) => {
      await api.profiles.update(profileName, { target });
      return target;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success(i18n.t('commonToast.defaultTargetUpdated'));
    },
    onError: (error: Error, target: CliTarget) => {
      const targetLabel =
        target === 'droid' ? 'Factory Droid' : target === 'codex' ? 'Codex CLI' : 'Claude Code';
      const suffix = error.message.trim() ? `: ${error.message}` : '';
      toast.error(i18n.t('commonToast.failedUpdateDefaultTarget', { target: targetLabel, suffix }));
    },
  });

  const resolvedTarget: CliTarget = profileTarget || 'claude';
  const isHeaderMutationPending = saveMutation.isPending || targetMutation.isPending;

  const handleConflictResolve = async (overwrite: boolean) => {
    setConflictDialog(false);
    if (overwrite) {
      await refetch();
      saveMutation.mutate();
    } else {
      setLocalEdits({});
      setRawJsonEdits(null);
    }
  };

  return (
    <div key={profileName} className="flex-1 flex flex-col overflow-hidden">
      <HeaderSection
        profileName={profileName}
        target={resolvedTarget}
        data={data}
        settings={currentSettings}
        isLoading={isLoading}
        isSaving={saveMutation.isPending}
        isTargetSaving={targetMutation.isPending}
        hasChanges={computedHasChanges}
        isRawJsonValid={computedIsRawJsonValid}
        onTargetChange={(target) => {
          if (isHeaderMutationPending) return;
          if (target === resolvedTarget) return;
          targetMutation.mutate(target);
        }}
        onRefresh={() => {
          if (isHeaderMutationPending) return;
          refetch();
        }}
        onDelete={onDelete}
        onSave={() => {
          if (isHeaderMutationPending) return;
          saveMutation.mutate();
        }}
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading settings...</span>
        </div>
      ) : isError ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">Failed to load settings.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 grid grid-cols-[40%_60%] divide-x overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted/5">
            <FriendlyUISection
              profileName={profileName}
              target={resolvedTarget}
              data={data}
              currentSettings={currentSettings}
              newEnvKey={newEnvKey}
              newEnvValue={newEnvValue}
              onNewEnvKeyChange={setNewEnvKey}
              onNewEnvValueChange={setNewEnvValue}
              onEnvValueChange={updateEnvValue}
              onEnvBulkChange={updateEnvBulk}
              onAddEnvVar={addNewEnvVar}
            />
          </div>
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="px-6 py-2 bg-muted/30 border-b flex items-center gap-2 shrink-0 h-[45px]">
              <Code2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">
                Raw Configuration (JSON)
              </span>
            </div>
            <RawEditorSection
              rawJsonContent={computedRawJsonContent}
              isRawJsonValid={computedIsRawJsonValid}
              rawJsonEdits={rawJsonEdits}
              settings={settings}
              profileTarget={resolvedTarget}
              imageAnalysisStatus={imageAnalysisStatus}
              imageAnalysisStatusSource={imageAnalysisStatusSource}
              imageAnalysisStatusPreviewState={imageAnalysisStatusPreviewState}
              nativeReadPreferenceOverride={nativeReadPreferenceOverride}
              onToggleNativeRead={updateNativeImageRead}
              onChange={handleRawJsonChange}
              missingRequiredFields={missingRequiredFields}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={conflictDialog}
        title="File Modified Externally"
        description="Overwrite with your changes or discard?"
        confirmText="Overwrite"
        variant="destructive"
        onConfirm={() => handleConflictResolve(true)}
        onCancel={() => handleConflictResolve(false)}
      />
    </div>
  );
}

// Re-exports
export { EnvEditorSection } from './env-editor-section';
export { InfoSection } from './info-section';
export { RawEditorSection } from './raw-editor-section';
export { HeaderSection } from './header-section';
export { FriendlyUISection } from './friendly-ui-section';
export { useProfileEditor } from './use-profile-editor';
export { isSensitiveKey, isOpenRouterProfile, extractTierMapping, applyTierMapping } from './utils';
export type { Settings, SettingsResponse, ProfileEditorProps } from './types';
