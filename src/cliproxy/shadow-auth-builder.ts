/**
 * Shadow Auth Directory Builder
 *
 * Creates a shadow copy of the auth directory for the model tier transformer.
 * Pro account files get `base_url` injected pointing to the local transformer proxy.
 * Ultra account files are copied unchanged.
 * Original auth files are NEVER modified.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getAuthDir, getTransformerAuthDir } from './config/path-resolver';
import { loadAccountsRegistry } from './accounts/registry';

/**
 * Create shadow auth directory with base_url injection for Pro accounts.
 * Returns the shadow dir path, or null if no mixed tiers detected.
 */
export function createTransformerShadowAuthDir(
  transformerPort: number,
  fallbackMap: Record<string, string>
): string | null {
  const authDir = getAuthDir();
  const shadowDir = getTransformerAuthDir();

  if (!fs.existsSync(authDir)) return null;

  // Load accounts registry for tier info
  const registry = loadAccountsRegistry();
  const agyAccounts = registry.providers?.agy;
  if (!agyAccounts) return null;

  // Check if mixed tiers exist among active accounts
  const tiers = new Set<string>();
  for (const [, meta] of Object.entries(agyAccounts.accounts)) {
    if (!meta.paused) {
      tiers.add(meta.tier || 'unknown');
    }
  }

  // Only create shadow dir if mixed tiers AND tier-gated models exist
  const hasUltra = tiers.has('ultra');
  const hasLowerTier = tiers.has('pro') || tiers.has('free') || tiers.has('unknown');
  if (!hasUltra || !hasLowerTier) return null;
  if (Object.keys(fallbackMap).length === 0) return null;

  // Clean and recreate shadow dir
  if (fs.existsSync(shadowDir)) {
    fs.rmSync(shadowDir, { recursive: true, force: true });
  }
  fs.mkdirSync(shadowDir, { recursive: true, mode: 0o700 });

  // Copy auth files with injection
  const files = fs.readdirSync(authDir).filter((f: string) => f.endsWith('.json'));
  const baseUrl = `http://127.0.0.1:${transformerPort}`;

  for (const file of files) {
    const srcPath = path.join(authDir, file);
    const dstPath = path.join(shadowDir, file);

    try {
      const content = fs.readFileSync(srcPath, 'utf-8');
      const data: Record<string, unknown> = JSON.parse(content);

      // Only inject for antigravity auth files
      if (data.type !== 'antigravity') {
        fs.writeFileSync(dstPath, content, { mode: 0o600 });
        continue;
      }

      // Find account tier from registry by matching token file
      const accountEntry = Object.entries(agyAccounts.accounts).find(
        ([, meta]) => meta.tokenFile === file
      );
      const tier = accountEntry?.[1]?.tier || 'unknown';

      if (tier === 'ultra') {
        // Ultra: copy unchanged
        fs.writeFileSync(dstPath, content, { mode: 0o600 });
      } else {
        // Pro/free/unknown: inject base_url to route through transformer
        data.base_url = baseUrl;
        fs.writeFileSync(dstPath, JSON.stringify(data, null, 2), { mode: 0o600 });
      }
    } catch {
      // Copy unchanged on parse error, skip if unreadable
      try {
        fs.copyFileSync(srcPath, dstPath);
      } catch {
        // File unreadable — skip (CLIProxy can't use it either)
      }
    }
  }

  return shadowDir;
}

/**
 * Remove transformer shadow auth directory.
 * Called on session cleanup (SIGINT/SIGTERM/exit).
 */
export function cleanupTransformerShadowAuthDir(): void {
  const shadowDir = getTransformerAuthDir();
  try {
    if (fs.existsSync(shadowDir)) {
      fs.rmSync(shadowDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup
  }
}
