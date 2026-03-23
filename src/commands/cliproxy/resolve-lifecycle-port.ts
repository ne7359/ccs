import { CLIPROXY_DEFAULT_PORT, validatePort } from '../../cliproxy/config/port-manager';
import { loadOrCreateUnifiedConfig } from '../../config/unified-config-loader';

/**
 * Resolve the local CLIProxy lifecycle port from unified config.
 * Falls back to default port when unset/invalid.
 */
export function resolveLifecyclePort(): number {
  const config = loadOrCreateUnifiedConfig();
  return validatePort(config.cliproxy_server?.local?.port ?? CLIPROXY_DEFAULT_PORT);
}
