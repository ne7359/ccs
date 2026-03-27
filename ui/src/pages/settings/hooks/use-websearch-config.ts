/**
 * WebSearch Config Hook
 */

import { useCallback } from 'react';
import { useSettingsContext, useSettingsActions } from './context-hooks';
import type { WebSearchConfig, WebSearchSavePayload } from '../types';

export function useWebSearchConfig() {
  const { state } = useSettingsContext();
  const actions = useSettingsActions();

  const fetchConfig = useCallback(async () => {
    try {
      actions.setWebSearchLoading(true);
      actions.setWebSearchError(null);
      const res = await fetch('/api/websearch');
      if (!res.ok) throw new Error('Failed to load WebSearch config');
      const data = await res.json();
      actions.setWebSearchConfig(data);
    } catch (err) {
      actions.setWebSearchError((err as Error).message);
    } finally {
      actions.setWebSearchLoading(false);
    }
  }, [actions]);

  const fetchStatus = useCallback(async () => {
    try {
      actions.setWebSearchStatusLoading(true);
      const res = await fetch('/api/websearch/status');
      if (!res.ok) throw new Error('Failed to load status');
      const data = await res.json();
      actions.setWebSearchStatus(data);
    } catch {
      // Silent fail for status
    } finally {
      actions.setWebSearchStatusLoading(false);
    }
  }, [actions]);

  const saveConfig = useCallback(
    async (updates: WebSearchSavePayload) => {
      const config = state.webSearchConfig;
      if (!config) return false;

      const optimisticConfig: WebSearchConfig = {
        ...config,
        ...updates,
        providers: { ...config.providers, ...updates.providers },
        apiKeys: config.apiKeys,
      };
      actions.setWebSearchConfig(optimisticConfig);

      try {
        actions.setWebSearchSaving(true);
        actions.setWebSearchError(null);

        const requestBody: WebSearchSavePayload = {
          enabled: optimisticConfig.enabled,
          providers: optimisticConfig.providers,
        };
        if (updates.apiKeys) {
          requestBody.apiKeys = updates.apiKeys;
        }

        const res = await fetch('/api/websearch', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to save');
        }

        const data = await res.json();
        actions.setWebSearchConfig(data.websearch);
        await fetchStatus();
        actions.setWebSearchSuccess(true);
        setTimeout(() => actions.setWebSearchSuccess(false), 1500);
        return true;
      } catch (err) {
        actions.setWebSearchConfig(config);
        actions.setWebSearchError((err as Error).message);
        return false;
      } finally {
        actions.setWebSearchSaving(false);
      }
    },
    [state.webSearchConfig, actions, fetchStatus]
  );

  return {
    config: state.webSearchConfig,
    status: state.webSearchStatus,
    loading: state.webSearchLoading,
    statusLoading: state.webSearchStatusLoading,
    saving: state.webSearchSaving,
    error: state.webSearchError,
    success: state.webSearchSuccess,
    fetchConfig,
    fetchStatus,
    saveConfig,
  };
}
