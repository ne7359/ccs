/**
 * CLIProxy Page - Master-Detail Layout
 * Left sidebar: Provider navigation + Quick actions
 * Right panel: Provider Editor with split-view (settings + code editor)
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, X, RefreshCw, Sparkles, Zap, GitBranch, Trash2 } from 'lucide-react';
import { QuickSetupWizard } from '@/components/quick-setup-wizard';
import { AddAccountDialog } from '@/components/account/add-account-dialog';
import { AccountSafetyWarningCard } from '@/components/account/account-safety-warning-card';
import { ProviderEditor } from '@/components/cliproxy/provider-editor';
import { ProviderLogo } from '@/components/cliproxy/provider-logo';
import { ProxyStatusWidget } from '@/components/monitoring/proxy-status-widget';
import {
  useCliproxy,
  useCliproxyAuth,
  useCliproxyUpdateCheck,
  useSetDefaultAccount,
  useRemoveAccount,
  usePauseAccount,
  useResumeAccount,
  useSoloAccount,
  useBulkPauseAccounts,
  useBulkResumeAccounts,
  useDeleteVariant,
} from '@/hooks/use-cliproxy';
import type { AuthStatus, Variant } from '@/lib/api-client';
import { MODEL_CATALOGS } from '@/lib/model-catalogs';
import { getProviderDisplayName, isValidProvider } from '@/lib/provider-config';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

// Sidebar provider item
function ProviderSidebarItem({
  status,
  isSelected,
  onSelect,
}: {
  status: AuthStatus;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const accountCount = status.accounts?.length || 0;

  return (
    <button
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-left',
        isSelected
          ? 'bg-primary/10 border border-primary/20'
          : 'hover:bg-muted border border-transparent'
      )}
      onClick={onSelect}
    >
      <ProviderLogo provider={status.provider} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{status.displayName}</span>
          {accountCount > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1">
              {accountCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {status.authenticated ? (
            <>
              <Check className="w-3 h-3 text-green-600" />
              <span className="text-xs text-green-600">{t('cliproxyPage.connected')}</span>
            </>
          ) : (
            <>
              <X className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {t('cliproxyPage.notConnected')}
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

// Sidebar variant item (user-created provider variants)
function VariantSidebarItem({
  variant,
  parentAuth,
  isSelected,
  onSelect,
  onDelete,
  isDeleting,
}: {
  variant: Variant;
  parentAuth?: AuthStatus;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
}) {
  const { t } = useTranslation();

  const handleActivate = () => {
    onSelect();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'group w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer text-left pl-6',
        isSelected
          ? 'bg-primary/10 border border-primary/20'
          : 'hover:bg-muted border border-transparent'
      )}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleActivate();
        }
      }}
    >
      <div className="relative">
        <ProviderLogo provider={variant.provider} size="sm" />
        <GitBranch className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{variant.name}</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1">
            {t('cliproxyPage.variant')}
          </Badge>
          <Badge variant="outline" className="text-[9px] h-4 px-1 uppercase">
            {variant.target || 'claude'}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {parentAuth?.authenticated ? (
            <>
              <Check className="w-3 h-3 text-green-600" />
              <span className="text-xs text-muted-foreground truncate">
                {t('cliproxyPage.viaProvider', { provider: variant.provider })}
              </span>
            </>
          ) : (
            <>
              <X className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {t('cliproxyPage.parentNotConnected')}
              </span>
            </>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={isDeleting}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

// Empty state for right panel
function EmptyProviderState({ onSetup }: { onSetup: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center bg-muted/20">
      <div className="text-center max-w-md px-8">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-6">
          <Zap className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">{t('cliproxyPage.emptyTitle')}</h2>
        <p className="text-muted-foreground mb-4">{t('cliproxyPage.emptyDesc')}</p>
        <p className="text-xs text-muted-foreground mb-6">
          {t('cliproxyPage.emptyControlPanelPrefix')}{' '}
          <a href="/cliproxy/control-panel" className="text-primary hover:underline">
            {t('cliproxyPage.controlPanel')}
          </a>
          .
        </p>
        <Button onClick={onSetup} className="gap-2">
          <Sparkles className="w-4 h-4" />
          {t('cliproxyPage.quickSetup')}
        </Button>
      </div>
    </div>
  );
}

export function CliproxyPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: authData, isLoading: authLoading } = useCliproxyAuth();
  const { data: variantsData, isFetching } = useCliproxy();
  const { data: updateCheck } = useCliproxyUpdateCheck();
  const setDefaultMutation = useSetDefaultAccount();
  const removeMutation = useRemoveAccount();
  const pauseMutation = usePauseAccount();
  const resumeMutation = useResumeAccount();
  const soloMutation = useSoloAccount();
  const bulkPauseMutation = useBulkPauseAccounts();
  const bulkResumeMutation = useBulkResumeAccounts();
  const deleteMutation = useDeleteVariant();

  // Selection state: either a provider or a variant
  // Initialize from URL provider deep-link, fallback to localStorage.
  const [selectedProvider, setSelectedProviderState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const query = new URLSearchParams(window.location.search);
      const queryProvider = query.get('provider')?.trim().toLowerCase();
      if (queryProvider && isValidProvider(queryProvider)) {
        return queryProvider;
      }
      return localStorage.getItem('cliproxy-selected-provider');
    }
    return null;
  });
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [addAccountProvider, setAddAccountProvider] = useState<{
    provider: string;
    displayName: string;
    isFirstAccount: boolean;
  } | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    const query = new URLSearchParams(window.location.search);
    const queryProvider = query.get('provider')?.trim().toLowerCase();
    const action = query.get('action');

    if (action !== 'auth' || !queryProvider || !isValidProvider(queryProvider)) {
      return null;
    }

    return {
      provider: queryProvider,
      displayName: getProviderDisplayName(queryProvider),
      isFirstAccount: false,
    };
  });

  const providers = useMemo(() => authData?.authStatus || [], [authData?.authStatus]);
  const isRemoteMode = authData?.source === 'remote';
  const variants = useMemo(() => variantsData?.variants || [], [variantsData?.variants]);

  // Wrapper to persist provider selection to localStorage
  const setSelectedProvider = (provider: string | null) => {
    setSelectedProviderState(provider);
    if (provider) {
      localStorage.setItem('cliproxy-selected-provider', provider);
    }
  };

  // Effective provider: prefer saved > first with accounts > first
  const effectiveProvider = useMemo(() => {
    if (selectedVariant) return null;

    // If saved/selected provider is valid, use it
    if (selectedProvider && providers.some((p) => p.provider === selectedProvider)) {
      return selectedProvider;
    }

    // Auto-select: prefer first provider with accounts (better UX)
    if (providers.length > 0) {
      const providerWithAccounts = providers.find((p) => (p.accounts?.length || 0) > 0);
      return providerWithAccounts?.provider || providers[0]?.provider || null;
    }
    return null;
  }, [selectedProvider, selectedVariant, providers]);

  const selectedStatus = providers.find((p) => p.provider === effectiveProvider);
  const selectedVariantData = variants.find((v) => v.name === selectedVariant);
  const parentAuthForVariant = selectedVariantData
    ? providers.find((p) => p.provider === selectedVariantData.provider)
    : undefined;
  const warningProvider = (selectedVariantData?.provider || selectedStatus?.provider || '')
    .toLowerCase()
    .trim();
  const showAccountSafetyWarning = warningProvider === 'gemini' || warningProvider === 'agy';

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cliproxy'] });
    queryClient.invalidateQueries({ queryKey: ['cliproxy-auth'] });
  };

  const handlePauseToggle = (provider: string, accountId: string, paused: boolean) => {
    // Prevent rapid clicks while mutation is pending
    if (pauseMutation.isPending || resumeMutation.isPending) return;
    if (paused) {
      pauseMutation.mutate({ provider, accountId });
    } else {
      resumeMutation.mutate({ provider, accountId });
    }
  };

  const handleSoloMode = (provider: string, accountId: string) => {
    if (soloMutation.isPending) return;
    soloMutation.mutate({ provider, accountId });
  };

  const handleBulkPause = (provider: string, accountIds: string[]) => {
    if (bulkPauseMutation.isPending) return;
    bulkPauseMutation.mutate({ provider, accountIds });
  };

  const handleBulkResume = (provider: string, accountIds: string[]) => {
    if (bulkResumeMutation.isPending) return;
    bulkResumeMutation.mutate({ provider, accountIds });
  };

  const handleSelectProvider = (provider: string) => {
    setSelectedProvider(provider);
    setSelectedVariant(null);
  };

  const handleSelectVariant = (variantName: string) => {
    setSelectedVariant(variantName);
    setSelectedProvider(null);
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-80 border-r flex flex-col bg-muted/30">
        {/* Header */}
        <div className="p-4 border-b bg-background">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              <h1 className="font-semibold">{updateCheck?.backendLabel ?? 'CLIProxy'}</h1>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleRefresh}
              disabled={isFetching}
            >
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {t('cliproxyPage.accountManagement')}
          </p>

          <Button
            variant="default"
            size="sm"
            className="w-full gap-2"
            onClick={() => setWizardOpen(true)}
          >
            <Sparkles className="w-4 h-4" />
            {t('cliproxyPage.quickSetup')}
          </Button>
        </div>

        {/* Providers List */}
        <ScrollArea className="flex-1">
          <div className="p-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 py-2">
              {t('cliproxyPage.providers')}
            </div>
            {authLoading ? (
              <div className="space-y-2 px-2">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {providers.map((status) => (
                  <ProviderSidebarItem
                    key={status.provider}
                    status={status}
                    isSelected={effectiveProvider === status.provider}
                    onSelect={() => handleSelectProvider(status.provider)}
                  />
                ))}
              </div>
            )}

            {/* Variants Section */}
            {variants.length > 0 && (
              <>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 py-2 mt-4 flex items-center gap-1.5">
                  <GitBranch className="w-3 h-3" />
                  {t('cliproxyPage.variants')}
                </div>
                <div className="space-y-1">
                  {variants.map((variant) => (
                    <VariantSidebarItem
                      key={variant.name}
                      variant={variant}
                      parentAuth={providers.find((p) => p.provider === variant.provider)}
                      isSelected={selectedVariant === variant.name}
                      onSelect={() => handleSelectVariant(variant.name)}
                      onDelete={() => deleteMutation.mutate(variant.name)}
                      isDeleting={deleteMutation.isPending}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        {/* Proxy Status Widget */}
        <div className="p-3 border-t">
          <ProxyStatusWidget />
        </div>

        {/* Footer Stats */}
        <div className="p-3 border-t bg-background text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>{t('cliproxyPage.providerCount', { count: providers.length })}</span>
            <span className="flex items-center gap-1">
              <Check className="w-3 h-3 text-green-600" />
              {t('cliproxyPage.connectedCount', {
                count: providers.filter((p) => p.authenticated).length,
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {showAccountSafetyWarning && (
          <AccountSafetyWarningCard showProxySettingsLink className="mx-4 mt-4" />
        )}

        {selectedVariantData && parentAuthForVariant ? (
          <>
            <ProviderEditor
              provider={selectedVariantData.name}
              displayName={t('cliproxyPage.variantDisplay', {
                name: selectedVariantData.name,
                provider: selectedVariantData.provider,
              })}
              authStatus={parentAuthForVariant}
              catalog={MODEL_CATALOGS[selectedVariantData.provider]}
              logoProvider={selectedVariantData.provider}
              baseProvider={selectedVariantData.provider}
              defaultTarget={selectedVariantData.target}
              isRemoteMode={isRemoteMode}
              port={selectedVariantData.port}
              onAddAccount={() =>
                setAddAccountProvider({
                  provider: selectedVariantData.provider,
                  displayName: parentAuthForVariant.displayName,
                  isFirstAccount: (parentAuthForVariant.accounts?.length || 0) === 0,
                })
              }
              onSetDefault={(accountId) =>
                setDefaultMutation.mutate({
                  provider: selectedVariantData.provider,
                  accountId,
                })
              }
              onRemoveAccount={(accountId) =>
                removeMutation.mutate({
                  provider: selectedVariantData.provider,
                  accountId,
                })
              }
              onPauseToggle={(accountId, paused) =>
                handlePauseToggle(selectedVariantData.provider, accountId, paused)
              }
              onSoloMode={(accountId) => handleSoloMode(selectedVariantData.provider, accountId)}
              onBulkPause={(accountIds) =>
                handleBulkPause(selectedVariantData.provider, accountIds)
              }
              onBulkResume={(accountIds) =>
                handleBulkResume(selectedVariantData.provider, accountIds)
              }
              isRemovingAccount={removeMutation.isPending}
              isPausingAccount={pauseMutation.isPending || resumeMutation.isPending}
              isSoloingAccount={soloMutation.isPending}
              isBulkPausing={bulkPauseMutation.isPending}
              isBulkResuming={bulkResumeMutation.isPending}
            />
          </>
        ) : selectedStatus ? (
          <>
            <ProviderEditor
              provider={selectedStatus.provider}
              displayName={selectedStatus.displayName}
              authStatus={selectedStatus}
              catalog={MODEL_CATALOGS[selectedStatus.provider]}
              isRemoteMode={isRemoteMode}
              onAddAccount={() =>
                setAddAccountProvider({
                  provider: selectedStatus.provider,
                  displayName: selectedStatus.displayName,
                  isFirstAccount: (selectedStatus.accounts?.length || 0) === 0,
                })
              }
              onSetDefault={(accountId) =>
                setDefaultMutation.mutate({
                  provider: selectedStatus.provider,
                  accountId,
                })
              }
              onRemoveAccount={(accountId) =>
                removeMutation.mutate({
                  provider: selectedStatus.provider,
                  accountId,
                })
              }
              onPauseToggle={(accountId, paused) =>
                handlePauseToggle(selectedStatus.provider, accountId, paused)
              }
              onSoloMode={(accountId) => handleSoloMode(selectedStatus.provider, accountId)}
              onBulkPause={(accountIds) => handleBulkPause(selectedStatus.provider, accountIds)}
              onBulkResume={(accountIds) => handleBulkResume(selectedStatus.provider, accountIds)}
              isRemovingAccount={removeMutation.isPending}
              isPausingAccount={pauseMutation.isPending || resumeMutation.isPending}
              isSoloingAccount={soloMutation.isPending}
              isBulkPausing={bulkPauseMutation.isPending}
              isBulkResuming={bulkResumeMutation.isPending}
            />
          </>
        ) : (
          <EmptyProviderState onSetup={() => setWizardOpen(true)} />
        )}
      </div>

      {/* Dialogs */}
      <QuickSetupWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <AddAccountDialog
        open={addAccountProvider !== null}
        onClose={() => setAddAccountProvider(null)}
        provider={addAccountProvider?.provider || ''}
        displayName={addAccountProvider?.displayName || ''}
        isFirstAccount={addAccountProvider?.isFirstAccount || false}
      />
    </div>
  );
}
