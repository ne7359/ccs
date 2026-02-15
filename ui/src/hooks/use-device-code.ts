/**
 * Device Code Hook
 *
 * Listens for WebSocket device code events and manages dialog state.
 * Similar to useProjectSelection but for Device Code OAuth flows
 * (GitHub Copilot, Qwen, Kiro, etc.)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { getProviderDeviceCodeDisplayName } from '@/lib/provider-config';

export interface DeviceCodePrompt {
  sessionId: string;
  provider: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
}

interface DeviceCodeState {
  isOpen: boolean;
  prompt: DeviceCodePrompt | null;
  error: string | null;
}

export function useDeviceCode() {
  const [state, setState] = useState<DeviceCodeState>({
    isOpen: false,
    prompt: null,
    error: null,
  });

  // Listen for WebSocket messages via custom events
  useEffect(() => {
    const handleMessage = (event: CustomEvent<{ type: string; [key: string]: unknown }>) => {
      const data = event.detail;

      if (data.type === 'deviceCodeReceived') {
        console.log('[DeviceCode] Received prompt:', data.sessionId);
        const displayName = getProviderDeviceCodeDisplayName(data.provider as string);
        toast.info(`${displayName} authorization required`);

        setState({
          isOpen: true,
          prompt: {
            sessionId: data.sessionId as string,
            provider: data.provider as string,
            userCode: data.userCode as string,
            verificationUrl: data.verificationUrl as string,
            expiresAt: data.expiresAt as number,
          },
          error: null,
        });
      } else if (data.type === 'deviceCodeCompleted') {
        console.log('[DeviceCode] Auth completed:', data.sessionId);
        setState((prev) => {
          if (prev.prompt && prev.prompt.sessionId === data.sessionId) {
            const displayName = getProviderDeviceCodeDisplayName(prev.prompt.provider);
            toast.success(`${displayName} authentication successful!`);
            return { isOpen: false, prompt: null, error: null };
          }
          return prev;
        });
      } else if (data.type === 'deviceCodeFailed') {
        console.log('[DeviceCode] Auth failed:', data.sessionId, data.error);
        setState((prev) => {
          if (prev.prompt && prev.prompt.sessionId === data.sessionId) {
            const displayName = getProviderDeviceCodeDisplayName(prev.prompt.provider);
            toast.error(`${displayName} authentication failed`);
            return { isOpen: false, prompt: null, error: data.error as string };
          }
          return prev;
        });
      } else if (data.type === 'deviceCodeExpired') {
        console.log('[DeviceCode] Code expired:', data.sessionId);
        setState((prev) => {
          if (prev.prompt?.sessionId === data.sessionId) {
            toast.error('Device code expired. Please try again.');
            return { isOpen: false, prompt: null, error: 'Device code expired' };
          }
          return prev;
        });
      }
    };

    // Listen for custom ws-message events dispatched by useWebSocket
    window.addEventListener('ws-message', handleMessage as EventListener);

    return () => {
      window.removeEventListener('ws-message', handleMessage as EventListener);
    };
  }, []);

  const handleClose = useCallback(() => {
    setState({ isOpen: false, prompt: null, error: null });
  }, []);

  const handleOpenUrl = useCallback(() => {
    if (state.prompt?.verificationUrl) {
      window.open(state.prompt.verificationUrl, '_blank', 'noopener,noreferrer');
    }
  }, [state.prompt]);

  const handleCopyCode = useCallback(async () => {
    if (state.prompt?.userCode) {
      try {
        await navigator.clipboard.writeText(state.prompt.userCode);
        toast.success('Code copied to clipboard');
      } catch {
        toast.error('Failed to copy code');
      }
    }
  }, [state.prompt]);

  return useMemo(
    () => ({
      isOpen: state.isOpen,
      prompt: state.prompt,
      error: state.error,
      onClose: handleClose,
      onOpenUrl: handleOpenUrl,
      onCopyCode: handleCopyCode,
    }),
    [state.isOpen, state.prompt, state.error, handleClose, handleOpenUrl, handleCopyCode]
  );
}
