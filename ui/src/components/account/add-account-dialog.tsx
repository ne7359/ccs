/**
 * Add Account Dialog Component
 * Uses /start-url to get OAuth URL + polls for completion via management API.
 * For Device Code flows (ghcp, qwen, kiro): Uses /start endpoint which spawns CLIProxy
 * binary and emits WebSocket events. DeviceCodeDialog handles user code display.
 * Shows auth URL + callback paste field. Polling auto-closes on success.
 * For Kiro: Also shows "Import from IDE" option.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ExternalLink, User, Download, Copy, Check, ShieldAlert } from 'lucide-react';
import { useKiroImport } from '@/hooks/use-cliproxy';
import { useCliproxyAuthFlow } from '@/hooks/use-cliproxy-auth-flow';
import { applyDefaultPreset } from '@/lib/preset-utils';
import { AccountSafetyWarningCard } from '@/components/account/account-safety-warning-card';
import { AntigravityResponsibilityChecklist } from '@/components/account/antigravity-responsibility-checklist';
import {
  ANTIGRAVITY_ACK_VERSION,
  DEFAULT_ANTIGRAVITY_RISK_CHECKLIST,
  RISK_ACK_PHRASE,
  isAntigravityRiskChecklistComplete,
} from '@/components/account/antigravity-responsibility-constants';
import {
  DEFAULT_KIRO_AUTH_METHOD,
  getKiroAuthMethodOption,
  isDeviceCodeProvider,
  KIRO_AUTH_METHOD_OPTIONS,
} from '@/lib/provider-config';
import type { KiroAuthMethod } from '@/lib/provider-config';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface AddAccountDialogProps {
  open: boolean;
  onClose: () => void;
  provider: string;
  displayName: string;
  /** Whether this is the first account being added (shows different toast message) */
  isFirstAccount?: boolean;
}

function normalizeRiskPhrase(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function AddAccountDialog({
  open,
  onClose,
  provider,
  displayName,
  isFirstAccount = false,
}: AddAccountDialogProps) {
  const [nickname, setNickname] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [riskAcknowledgementText, setRiskAcknowledgementText] = useState('');
  const [agyRiskChecklist, setAgyRiskChecklist] = useState(DEFAULT_ANTIGRAVITY_RISK_CHECKLIST);
  const [powerUserModeEnabled, setPowerUserModeEnabled] = useState(false);
  const [powerUserModeLoading, setPowerUserModeLoading] = useState(false);
  const [kiroAuthMethod, setKiroAuthMethod] = useState<KiroAuthMethod>(DEFAULT_KIRO_AUTH_METHOD);
  const { t } = useTranslation();
  const wasAuthenticatingRef = useRef(false);
  const authFlow = useCliproxyAuthFlow();
  const kiroImportMutation = useKiroImport();

  const isKiro = provider === 'kiro';
  const supportsPowerUserMode = provider === 'agy' || provider === 'gemini';
  const requiresGeminiSafetyAcknowledgement = provider === 'gemini' && !powerUserModeEnabled;
  const requiresAgyResponsibilityFlow = provider === 'agy' && !powerUserModeEnabled;
  const isPowerUserModePending = supportsPowerUserMode && powerUserModeLoading;
  const isAgyRiskChecklistComplete = isAntigravityRiskChecklistComplete(agyRiskChecklist);
  const isGeminiRiskAcknowledged = normalizeRiskPhrase(riskAcknowledgementText) === RISK_ACK_PHRASE;
  const defaultDeviceCode = isDeviceCodeProvider(provider);
  const kiroMethodOption = getKiroAuthMethodOption(kiroAuthMethod);
  const isDeviceCode = isKiro ? kiroMethodOption.flowType === 'device_code' : defaultDeviceCode;
  const isPending = authFlow.isAuthenticating || kiroImportMutation.isPending;
  const nicknameTrimmed = nickname.trim();
  const errorMessage = localError || authFlow.error;

  const fetchPowerUserModeState = useCallback(async (): Promise<boolean> => {
    const response = await fetch('/api/settings/auth/antigravity-risk');
    if (!response.ok) {
      throw new Error('Failed to load power user mode setting');
    }
    const data = (await response.json()) as { antigravityAckBypass?: boolean };
    return data.antigravityAckBypass === true;
  }, []);

  const resetAndClose = () => {
    setNickname('');
    setCallbackUrl('');
    setCopied(false);
    setLocalError(null);
    setRiskAcknowledgementText('');
    setAgyRiskChecklist(DEFAULT_ANTIGRAVITY_RISK_CHECKLIST);
    setPowerUserModeEnabled(false);
    setPowerUserModeLoading(false);
    setKiroAuthMethod(DEFAULT_KIRO_AUTH_METHOD);
    wasAuthenticatingRef.current = false;
    onClose();
  };

  useEffect(() => {
    if (open) {
      setRiskAcknowledgementText('');
      setAgyRiskChecklist(DEFAULT_ANTIGRAVITY_RISK_CHECKLIST);
      setLocalError(null);
    }
  }, [provider, open]);

  useEffect(() => {
    let cancelled = false;

    if (!open || !supportsPowerUserMode) {
      setPowerUserModeEnabled(false);
      setPowerUserModeLoading(false);
      return;
    }

    const loadPowerUserModeState = async () => {
      try {
        setPowerUserModeLoading(true);
        const enabled = await fetchPowerUserModeState();
        if (!cancelled) {
          setPowerUserModeEnabled(enabled);
        }
      } catch {
        if (!cancelled) {
          setPowerUserModeEnabled(false);
        }
      } finally {
        if (!cancelled) {
          setPowerUserModeLoading(false);
        }
      }
    };

    loadPowerUserModeState();

    return () => {
      cancelled = true;
    };
  }, [fetchPowerUserModeState, open, supportsPowerUserMode]);

  useEffect(() => {
    if (!open || provider !== 'agy' || !authFlow.error || !powerUserModeEnabled) {
      return;
    }

    const normalizedError = authFlow.error.toLowerCase();
    const ackRequired =
      normalizedError.includes('agy_risk_ack_required') ||
      normalizedError.includes('responsibility acknowledgement') ||
      normalizedError.includes('responsibility checklist');
    if (!ackRequired) return;

    let cancelled = false;

    const syncBypassState = async () => {
      try {
        setPowerUserModeLoading(true);
        const enabled = await fetchPowerUserModeState();
        if (cancelled) return;
        setPowerUserModeEnabled(enabled);
        if (!enabled) {
          setLocalError('Power user mode is off. Complete the AGY checklist and retry.');
        }
      } catch {
        if (cancelled) return;
        setPowerUserModeEnabled(false);
        setLocalError('Power user mode is off. Complete the AGY checklist and retry.');
      } finally {
        if (!cancelled) {
          setPowerUserModeLoading(false);
        }
      }
    };

    void syncBypassState();

    return () => {
      cancelled = true;
    };
  }, [authFlow.error, fetchPowerUserModeState, open, powerUserModeEnabled, provider]);

  // When authFlow completes successfully (polling detected success), apply preset and close
  useEffect(() => {
    if (!authFlow.isAuthenticating && !authFlow.error && authFlow.provider === null && open) {
      if (wasAuthenticatingRef.current) {
        wasAuthenticatingRef.current = false;
        const applyPresetAndClose = async () => {
          try {
            const result = await applyDefaultPreset(provider);
            if (result.success && result.presetName && isFirstAccount) {
              toast.success(`Applied "${result.presetName}" preset`);
            }
          } catch {
            // Continue to close dialog even if preset apply fails
          }
          resetAndClose();
        };
        applyPresetAndClose();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFlow.isAuthenticating, authFlow.error, authFlow.provider]);

  const handleCancel = () => {
    // Always cancel authFlow (handles its own no-op if not active)
    authFlow.cancelAuth();
    resetAndClose();
  };

  const handleCopyUrl = async () => {
    if (authFlow.authUrl) {
      await navigator.clipboard.writeText(authFlow.authUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubmitCallback = () => {
    if (callbackUrl.trim()) {
      authFlow.submitCallback(callbackUrl.trim());
    }
  };

  /**
   * Start auth flow using provider capabilities.
   * - Device code providers use /start and rely on WebSocket events for code display.
   * - Authorization code providers use /start-url and polling.
   */
  const handleAuthenticate = () => {
    if (isPowerUserModePending) {
      setLocalError('Loading power user safety settings. Please wait a moment and retry.');
      return;
    }
    if (requiresAgyResponsibilityFlow && !isAgyRiskChecklistComplete) {
      setLocalError(
        'Complete all Antigravity responsibility steps before authenticating this provider.'
      );
      return;
    }
    if (requiresGeminiSafetyAcknowledgement && !isGeminiRiskAcknowledged) {
      setLocalError(
        `Type "${RISK_ACK_PHRASE}" to acknowledge the account safety warning before authenticating this provider.`
      );
      return;
    }
    setLocalError(null);
    wasAuthenticatingRef.current = true;
    authFlow.startAuth(provider, {
      nickname: nicknameTrimmed || undefined,
      kiroMethod: isKiro ? kiroAuthMethod : undefined,
      flowType: isKiro ? kiroMethodOption.flowType : undefined,
      startEndpoint: isKiro ? kiroMethodOption.startEndpoint : undefined,
      riskAcknowledgement: requiresAgyResponsibilityFlow
        ? {
            version: ANTIGRAVITY_ACK_VERSION,
            reviewedIssue509: agyRiskChecklist.reviewedIssue509,
            understandsBanRisk: agyRiskChecklist.understandsBanRisk,
            acceptsFullResponsibility: agyRiskChecklist.acceptsFullResponsibility,
            typedPhrase: agyRiskChecklist.typedPhrase,
          }
        : undefined,
    });
  };

  const handleKiroImport = () => {
    wasAuthenticatingRef.current = true;
    kiroImportMutation.mutate(undefined, {
      onSuccess: async () => {
        const result = await applyDefaultPreset('kiro');
        if (result.success && result.presetName && isFirstAccount) {
          toast.success(`Applied "${result.presetName}" preset`);
        }
        resetAndClose();
      },
    });
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      handleCancel();
    }
  };

  const showAuthUI = authFlow.isAuthenticating;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          // Prevent accidental close by clicking outside during auth
          if (showAuthUI) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('addAccountDialog.title', { displayName })}</DialogTitle>
          <DialogDescription>
            {isKiro
              ? t('addAccountDialog.descKiro')
              : isDeviceCode
                ? t('addAccountDialog.descDeviceCode')
                : t('addAccountDialog.descOauth')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {requiresAgyResponsibilityFlow && !showAuthUI && (
            <AntigravityResponsibilityChecklist
              value={agyRiskChecklist}
              onChange={(value) => {
                setAgyRiskChecklist(value);
                setLocalError(null);
              }}
              disabled={isPending}
            />
          )}

          {supportsPowerUserMode && powerUserModeEnabled && !showAuthUI && (
            <div className="rounded-lg border border-amber-400/35 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-100">
              <div className="mb-1.5 flex items-center gap-1.5 font-semibold">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t('addAccountDialog.powerUserEnabled')}
              </div>
              {t('addAccountDialog.powerUserSkipped')}
            </div>
          )}

          {requiresGeminiSafetyAcknowledgement && !showAuthUI && (
            <AccountSafetyWarningCard
              showAcknowledgement
              acknowledgementPhrase={RISK_ACK_PHRASE}
              acknowledgementText={riskAcknowledgementText}
              onAcknowledgementTextChange={(value) => {
                setRiskAcknowledgementText(value);
                setLocalError(null);
              }}
              disabled={isPending}
            />
          )}

          {/* Kiro auth method */}
          {isKiro && !showAuthUI && (
            <div className="space-y-2">
              <Label htmlFor="kiro-auth-method">{t('addAccountDialog.authMethod')}</Label>
              <Select
                value={kiroAuthMethod}
                onValueChange={(value) => {
                  setKiroAuthMethod(value as KiroAuthMethod);
                  setLocalError(null);
                }}
              >
                <SelectTrigger id="kiro-auth-method">
                  <SelectValue placeholder={t('addAccountDialog.selectKiroAuthMethod')} />
                </SelectTrigger>
                <SelectContent>
                  {KIRO_AUTH_METHOD_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{kiroMethodOption.description}</p>
            </div>
          )}

          {/* Nickname input - only show before auth starts */}
          {!showAuthUI && (
            <div className="space-y-2">
              <Label htmlFor="nickname">{t('addAccountDialog.nicknameOptional')}</Label>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <Input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setLocalError(null);
                  }}
                  placeholder={t('addAccountDialog.nicknamePlaceholder')}
                  disabled={isPending}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('addAccountDialog.nicknameOptionalHint')}
              </p>
            </div>
          )}

          {/* Unified auth state: spinner + auth URL + callback paste */}
          {showAuthUI && (
            <div className="space-y-4">
              {/* Spinner */}
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 inline mr-2 animate-spin" />
                  {t('addAccountDialog.waitingForAuth')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {authFlow.isDeviceCodeFlow
                    ? t('addAccountDialog.deviceCodeHint')
                    : t('addAccountDialog.browserHint')}
                </p>
              </div>

              {/* Auth URL section - only for Authorization Code flows, NOT Device Code */}
              {authFlow.authUrl && !authFlow.isDeviceCodeFlow && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs">{t('addAccountDialog.openUrlLabel')}</Label>
                    <div className="p-3 bg-muted rounded-md">
                      <p className="text-xs text-muted-foreground break-all font-mono line-clamp-3">
                        {authFlow.authUrl}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm" onClick={handleCopyUrl}>
                          {copied ? (
                            <>
                              <Check className="w-3 h-3 mr-1" />
                              {t('addAccountDialog.copied')}
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 mr-1" />
                              {t('addAccountDialog.copy')}
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (!authFlow.authUrl) return;
                            const popup = window.open(authFlow.authUrl, '_blank');
                            if (!popup || popup.closed || typeof popup.closed === 'undefined') {
                              toast.warning(t('addAccountDialog.popupBlocked'), { duration: 5000 });
                            }
                          }}
                        >
                          <ExternalLink className="w-3 h-3 mr-1" />
                          {t('addAccountDialog.open')}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Callback paste field */}
                  <div className="space-y-2">
                    <Label htmlFor="callback-url" className="text-xs">
                      {t('addAccountDialog.redirectPasteLabel')}
                    </Label>
                    <Input
                      id="callback-url"
                      value={callbackUrl}
                      onChange={(e) => setCallbackUrl(e.target.value)}
                      placeholder={t('addAccountDialog.callbackPlaceholder')}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSubmitCallback}
                      disabled={!callbackUrl.trim() || authFlow.isSubmittingCallback}
                    >
                      {authFlow.isSubmittingCallback ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          {t('addAccountDialog.submitting')}
                        </>
                      ) : (
                        t('addAccountDialog.submitCallback')
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {!authFlow.authUrl && !authFlow.isDeviceCodeFlow && (
                <p className="text-xs text-center text-muted-foreground">
                  {t('addAccountDialog.preparingUrl')}
                </p>
              )}
            </div>
          )}

          {/* Persist error visibility outside auth-only UI states */}
          {errorMessage && <p className="text-xs text-center text-destructive">{errorMessage}</p>}

          {/* Kiro import loading */}
          {kiroImportMutation.isPending && (
            <p className="text-sm text-center text-muted-foreground">
              <Loader2 className="w-4 h-4 inline mr-2 animate-spin" />
              {t('addAccountDialog.importingToken')}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={handleCancel}>
              {t('addAccountDialog.cancel')}
            </Button>
            {isKiro && !showAuthUI && (
              <Button variant="outline" onClick={handleKiroImport} disabled={isPending}>
                {kiroImportMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('addAccountDialog.importing')}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    {t('addAccountDialog.importFromIde')}
                  </>
                )}
              </Button>
            )}
            {!showAuthUI && (
              <Button
                onClick={handleAuthenticate}
                disabled={
                  isPending ||
                  isPowerUserModePending ||
                  (requiresAgyResponsibilityFlow && !isAgyRiskChecklistComplete) ||
                  (requiresGeminiSafetyAcknowledgement && !isGeminiRiskAcknowledged)
                }
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                {t('addAccountDialog.authenticate')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
