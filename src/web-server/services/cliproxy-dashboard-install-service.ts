import { installCliproxyVersion } from '../../cliproxy/binary-manager';
import { ensureCliproxyService, type ServiceStartResult } from '../../cliproxy/service-manager';
import { getProxyStatus as getProxyProcessStatus } from '../../cliproxy/session-tracker';
import { isCliproxyRunning } from '../../cliproxy/stats-fetcher';
import type { CLIProxyBackend } from '../../cliproxy/types';

interface ProxyStatusLike {
  running: boolean;
}

interface InstallDashboardCliproxyVersionDeps {
  getProxyStatus: () => ProxyStatusLike;
  isCliproxyRunning: () => Promise<boolean>;
  installCliproxyVersion: (
    version: string,
    verbose?: boolean,
    backend?: CLIProxyBackend
  ) => Promise<void>;
  ensureCliproxyService: () => Promise<ServiceStartResult>;
}

const defaultDeps: InstallDashboardCliproxyVersionDeps = {
  getProxyStatus: getProxyProcessStatus,
  isCliproxyRunning,
  installCliproxyVersion,
  ensureCliproxyService: () => ensureCliproxyService(),
};

export interface DashboardCliproxyInstallResult {
  success: boolean;
  restarted: boolean;
  port?: number;
  message: string;
  error?: string;
}

async function wasProxyRunning(deps: InstallDashboardCliproxyVersionDeps): Promise<boolean> {
  const status = deps.getProxyStatus();
  if (status.running) {
    return true;
  }

  return deps.isCliproxyRunning();
}

export async function installDashboardCliproxyVersion(
  version: string,
  backend: CLIProxyBackend,
  deps: InstallDashboardCliproxyVersionDeps = defaultDeps
): Promise<DashboardCliproxyInstallResult> {
  const backendLabel = backend === 'plus' ? 'CLIProxy Plus' : 'CLIProxy';
  const shouldRestoreService = await wasProxyRunning(deps);

  // The installer owns the stop-and-replace lifecycle, including best-effort
  // shutdown for tracked and untracked proxies before swapping the binary.
  await deps.installCliproxyVersion(version, true, backend);

  if (!shouldRestoreService) {
    return {
      success: true,
      restarted: false,
      message: `Successfully installed ${backendLabel} v${version}`,
    };
  }

  const startResult = await deps.ensureCliproxyService();
  if (!startResult.started && !startResult.alreadyRunning) {
    return {
      success: false,
      restarted: false,
      error: startResult.error || `Installed ${backendLabel} v${version}, but restart failed`,
      message: `Installed ${backendLabel} v${version}, but failed to restart it`,
    };
  }

  return {
    success: true,
    restarted: true,
    port: startResult.port,
    message: `Successfully installed ${backendLabel} v${version} and restarted it on port ${startResult.port}`,
  };
}
