/**
 * Copilot Config Form Hook
 * State management for the copilot config form
 */

import { useState, useMemo, useCallback } from 'react';
import { useCopilot } from '@/hooks/use-copilot';
import { isApiConflictError } from '@/lib/api-client';
import { toast } from 'sonner';
import type { ModelPreset } from './types';

/** Required env vars for Copilot settings (informational only - runtime fills defaults) */
const REQUIRED_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'] as const;

/** Check settings for missing fields (for UI warnings) */
function checkMissingFields(settings: { env?: Record<string, string> } | undefined): string[] {
  const env = settings?.env || {};
  return REQUIRED_ENV_KEYS.filter((key) => !env[key]?.trim());
}

export function useCopilotConfigForm() {
  const {
    config,
    configLoading,
    models,
    modelsLoading,
    rawSettings,
    rawSettingsLoading,
    updateConfigAsync,
    isUpdating,
    saveRawSettingsAsync,
    isSavingRawSettings,
    refetchRawSettings,
  } = useCopilot();

  // Track local overrides for form fields
  const [localOverrides, setLocalOverrides] = useState<{
    enabled?: boolean;
    autoStart?: boolean;
    port?: number;
    accountType?: 'individual' | 'business' | 'enterprise';
    model?: string;
    rateLimit?: string;
    waitOnLimit?: boolean;
    opusModel?: string;
    sonnetModel?: string;
    haikuModel?: string;
  }>({});

  // Raw JSON editor state
  const [rawJsonEdits, setRawJsonEdits] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState(false);

  // Use local overrides if set, otherwise use config values
  const enabled = localOverrides.enabled ?? config?.enabled ?? false;
  const autoStart = localOverrides.autoStart ?? config?.auto_start ?? false;
  const port = localOverrides.port ?? config?.port ?? 4141;
  const accountType = localOverrides.accountType ?? config?.account_type ?? 'individual';
  const currentModel = localOverrides.model ?? config?.model ?? 'claude-sonnet-4-6';
  const rateLimit = localOverrides.rateLimit ?? config?.rate_limit?.toString() ?? '';
  const waitOnLimit = localOverrides.waitOnLimit ?? config?.wait_on_limit ?? true;
  const opusModel = localOverrides.opusModel ?? config?.opus_model ?? '';
  const sonnetModel = localOverrides.sonnetModel ?? config?.sonnet_model ?? '';
  const haikuModel = localOverrides.haikuModel ?? config?.haiku_model ?? '';

  const updateField = <K extends keyof typeof localOverrides>(
    key: K,
    value: (typeof localOverrides)[K]
  ) => {
    setLocalOverrides((prev) => ({ ...prev, [key]: value }));
  };

  // Batch update for presets
  const applyPreset = (preset: ModelPreset) => {
    setLocalOverrides((prev) => ({
      ...prev,
      model: preset.default,
      opusModel: preset.opus,
      sonnetModel: preset.sonnet,
      haikuModel: preset.haiku,
    }));
    toast.success(`Applied "${preset.name}" preset`);
  };

  // Raw JSON content
  const rawJsonContent = useMemo(() => {
    if (rawJsonEdits !== null) return rawJsonEdits;
    if (rawSettings?.settings) return JSON.stringify(rawSettings.settings, null, 2);
    return '{\n  "env": {}\n}';
  }, [rawJsonEdits, rawSettings]);

  const handleRawJsonChange = useCallback((value: string) => {
    setRawJsonEdits(value);
  }, []);

  // Check if JSON is valid
  const isRawJsonValid = useMemo(() => {
    try {
      JSON.parse(rawJsonContent);
      return true;
    } catch {
      return false;
    }
  }, [rawJsonContent]);

  // Check for unsaved changes
  const hasChanges = useMemo(() => {
    const hasLocalChanges = Object.keys(localOverrides).length > 0;
    const hasJsonChanges =
      rawJsonEdits !== null && rawJsonEdits !== JSON.stringify(rawSettings?.settings, null, 2);
    return hasLocalChanges || hasJsonChanges;
  }, [localOverrides, rawJsonEdits, rawSettings]);

  // Validation state for missing required fields (informational warning)
  const currentSettingsForValidation = useMemo(() => {
    if (rawJsonEdits !== null) {
      try {
        return JSON.parse(rawJsonEdits);
      } catch {
        return rawSettings?.settings;
      }
    }
    return rawSettings?.settings;
  }, [rawJsonEdits, rawSettings?.settings]);

  const missingFields = useMemo(
    () => checkMissingFields(currentSettingsForValidation),
    [currentSettingsForValidation]
  );

  const handleSave = async () => {
    try {
      // Save config changes
      if (Object.keys(localOverrides).length > 0) {
        await updateConfigAsync({
          enabled,
          auto_start: autoStart,
          port,
          account_type: accountType,
          model: currentModel,
          rate_limit: rateLimit ? parseInt(rateLimit, 10) : null,
          wait_on_limit: waitOnLimit,
          opus_model: opusModel || undefined,
          sonnet_model: sonnetModel || undefined,
          haiku_model: haikuModel || undefined,
        });
      }

      // Save raw JSON changes (no blocking validation - runtime uses defaults)
      if (rawJsonEdits !== null && isRawJsonValid) {
        const settingsToSave = JSON.parse(rawJsonContent);
        const missing = checkMissingFields(settingsToSave);

        await saveRawSettingsAsync({
          settings: settingsToSave,
          expectedMtime: rawSettings?.mtime,
        });

        // Show warning if fields missing
        if (missing.length > 0) {
          toast.success('Copilot configuration saved', {
            description: `Missing fields will use defaults: ${missing.join(', ')}`,
          });
        } else {
          toast.success('Copilot configuration saved');
        }
      } else {
        toast.success('Copilot configuration saved');
      }

      // Clear local state
      setLocalOverrides({});
      setRawJsonEdits(null);
    } catch (error) {
      if (isApiConflictError(error)) {
        setConflictDialog(true);
      } else {
        toast.error('Failed to save settings');
      }
    }
  };

  const handleConflictResolve = async (overwrite: boolean) => {
    setConflictDialog(false);
    if (overwrite) {
      await refetchRawSettings();
      handleSave();
    } else {
      setRawJsonEdits(null);
    }
  };

  return {
    // Loading states
    configLoading,
    rawSettingsLoading,
    modelsLoading,
    isUpdating,
    isSavingRawSettings,

    // Data
    models,
    rawSettings,
    rawJsonContent,
    rawJsonEdits,

    // Computed values
    enabled,
    autoStart,
    port,
    accountType,
    currentModel,
    rateLimit,
    waitOnLimit,
    opusModel,
    sonnetModel,
    haikuModel,
    isRawJsonValid,
    hasChanges,

    // Dialog state
    conflictDialog,

    // Actions
    updateField,
    applyPreset,
    handleRawJsonChange,
    handleSave,
    handleConflictResolve,
    refetchRawSettings,

    /** List of required env vars that are missing (empty if all present) - informational */
    missingRequiredFields: missingFields,
  };
}
