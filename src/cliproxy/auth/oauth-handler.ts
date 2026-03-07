/**
 * OAuth Handler for CLIProxyAPI
 *
 * Manages OAuth authentication flow for CLIProxy providers (Gemini, Codex, Antigravity, Kiro, Copilot).
 * CLIProxyAPI handles OAuth internally - we just need to:
 * 1. Check if auth exists (token files in CCS auth directory)
 * 2. Trigger OAuth flow by spawning binary with auth flag
 * 3. Auto-detect headless environments (SSH, no DISPLAY)
 * 4. Use --no-browser flag for headless, display OAuth URL for manual auth
 * 5. Handle Device Code flows for Copilot/Qwen (no callback server)
 */

import * as fs from 'fs';
import { fail, info, warn, color, ok } from '../../utils/ui';
import { ensureCLIProxyBinary } from '../binary-manager';
import { generateConfig } from '../config-generator';
import { CLIProxyProvider } from '../types';
import {
  AccountInfo,
  getProviderAccounts,
  getDefaultAccount,
  touchAccount,
  PROVIDERS_WITHOUT_EMAIL,
  validateNickname,
} from '../account-manager';
import {
  enhancedPreflightOAuthCheck,
  OAUTH_CALLBACK_PORTS as OAUTH_PORTS,
} from '../../management/oauth-port-diagnostics';
import {
  OAuthOptions,
  DEFAULT_KIRO_AUTH_METHOD,
  getKiroCallbackPort,
  getKiroCLIAuthFlag,
  isKiroCLIAuthMethod,
  isKiroDeviceCodeMethod,
  getOAuthConfig,
  ProviderOAuthConfig,
  CLIPROXY_CALLBACK_PROVIDER_MAP,
  getPasteCallbackStartPath,
  getManagementOAuthCallbackPath,
  normalizeKiroAuthMethod,
} from './auth-types';
import { isHeadlessEnvironment, killProcessOnPort, showStep } from './environment-detector';
import { getProviderTokenDir, isAuthenticated, registerAccountFromToken } from './token-manager';
import { executeOAuthProcess } from './oauth-process';
import { importKiroToken } from './kiro-import';
import {
  getProxyTarget,
  buildProxyUrl,
  buildManagementHeaders,
  type ProxyTarget,
} from '../proxy-target-resolver';
import {
  checkNewAccountConflict,
  warnNewAccountConflict,
  warnOAuthBanRisk,
  warnPossible403Ban,
} from '../account-safety';
import { ensureCliAntigravityResponsibility } from '../antigravity-responsibility';

interface PasteCallbackStartData {
  url?: string;
  auth_url?: string;
  state?: string;
  status?: string;
}

const PASTE_CALLBACK_AUTH_URL_POLL_INTERVAL_MS = 3000;

export async function requestPasteCallbackStart(
  provider: CLIProxyProvider,
  target: ProxyTarget
): Promise<PasteCallbackStartData> {
  const startPath = getPasteCallbackStartPath(provider);
  const response = await fetch(buildProxyUrl(target, startPath), {
    ...(provider === 'kiro' ? { method: 'POST' } : {}),
    headers:
      provider === 'kiro'
        ? buildManagementHeaders(target, { 'Content-Type': 'application/json' })
        : buildManagementHeaders(target),
  });

  if (!response.ok) {
    throw new Error(`OAuth start failed with status ${response.status}`);
  }

  return (await response.json()) as PasteCallbackStartData;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolvePasteCallbackAuthUrl(
  target: ProxyTarget,
  startData: PasteCallbackStartData,
  timeoutMs: number,
  pollIntervalMs: number = PASTE_CALLBACK_AUTH_URL_POLL_INTERVAL_MS
): Promise<string | null> {
  const authUrl = startData.url || startData.auth_url;
  if (authUrl) {
    return authUrl;
  }

  const state = startData.state;
  if (!state) {
    return null;
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(
      buildProxyUrl(target, `/v0/management/get-auth-status?state=${encodeURIComponent(state)}`),
      { headers: buildManagementHeaders(target) }
    );

    if (response.ok) {
      const statusData = (await response.json()) as PasteCallbackStartData;
      const polledAuthUrl = statusData.url || statusData.auth_url;

      if (polledAuthUrl) {
        return polledAuthUrl;
      }

      if (statusData.status === 'error' || statusData.status === 'device_code') {
        return null;
      }
    }

    if (Date.now() + pollIntervalMs >= deadline) {
      break;
    }

    await sleep(pollIntervalMs);
  }

  return null;
}

/**
 * Prompt user to add another account
 */
async function promptAddAccount(): Promise<boolean> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question('[?] Add another account? (y/N): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Prompt user to choose OAuth mode for headless environment
 * Returns 'paste' for paste-callback mode or 'forward' for port-forwarding
 */
async function promptOAuthModeChoice(callbackPort: number | null): Promise<'paste' | 'forward'> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('');
  console.log(info('Headless environment detected (SSH session)'));
  console.log('    OAuth requires choosing a mode:');
  console.log('');
  console.log('    [1] Paste-callback (recommended for VPS)');
  console.log('        Open URL in any browser, paste redirect URL back');
  console.log('');
  console.log('    [2] Port forwarding (advanced)');
  if (callbackPort) {
    console.log(`        Requires: ssh -L ${callbackPort}:localhost:${callbackPort} <USER>@<HOST>`);
  } else {
    console.log('        Requires SSH tunnel to callback port');
  }
  console.log('');

  return new Promise<'paste' | 'forward'>((resolve) => {
    let resolved = false;

    // Handle Ctrl+C gracefully
    rl.on('close', () => {
      if (!resolved) {
        resolved = true;
        resolve('paste'); // Safe default on cancel
      }
    });

    rl.question('[?] Which mode? (1/2): ', (answer) => {
      const choice = answer.trim();
      if (choice !== '1' && choice !== '2') {
        console.log(info('Invalid choice, using paste-callback mode'));
      }
      resolved = true;
      rl.close();
      resolve(choice === '2' ? 'forward' : 'paste');
    });
  });
}

/**
 * Prompt user for account nickname (required for kiro/ghcp)
 * Returns null if user cancels
 */
async function promptNickname(
  provider: CLIProxyProvider,
  existingAccounts: AccountInfo[]
): Promise<string | null> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const existingNicknames = existingAccounts.map(
    (a) => a.nickname?.toLowerCase() || a.id.toLowerCase()
  );

  console.log('');
  console.log(info(`${provider} accounts require a unique nickname to distinguish them.`));
  if (existingNicknames.length > 0) {
    console.log(`    Existing: ${existingNicknames.join(', ')}`);
  }

  return new Promise<string | null>((resolve) => {
    let resolved = false;

    // Handle Ctrl+C gracefully (only if not already resolved)
    rl.on('close', () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });

    const askForNickname = () => {
      rl.question('[?] Enter a nickname for this account: ', (answer) => {
        const nickname = answer.trim();

        if (!nickname) {
          console.log(fail('Nickname cannot be empty'));
          askForNickname();
          return;
        }

        const validationError = validateNickname(nickname);
        if (validationError) {
          console.log(fail(validationError));
          askForNickname();
          return;
        }

        if (existingNicknames.includes(nickname.toLowerCase())) {
          console.log(fail(`Nickname "${nickname}" is already in use. Choose a different one.`));
          askForNickname();
          return;
        }

        resolved = true;
        rl.close();
        resolve(nickname);
      });
    };

    askForNickname();
  });
}

/**
 * Run pre-flight OAuth checks
 */
async function runPreflightChecks(
  provider: CLIProxyProvider,
  oauthConfig: { displayName: string }
): Promise<boolean> {
  console.log('');
  console.log(info(`Pre-flight OAuth check for ${oauthConfig.displayName}...`));

  const preflight = await enhancedPreflightOAuthCheck(provider);

  for (const check of preflight.checks) {
    const icon = check.status === 'ok' ? '[OK]' : check.status === 'warn' ? '[!]' : '[X]';
    console.log(`  ${icon} ${check.name}: ${check.message}`);
    if (check.fixCommand && check.status !== 'ok') {
      console.log(`      Fix: ${check.fixCommand}`);
    }
  }

  if (preflight.firewallWarning) {
    console.log('');
    console.log(warn('Windows Firewall may block OAuth callback'));
    console.log('    If auth hangs, run as Administrator:');
    console.log(`    ${color(preflight.firewallFixCommand || '', 'command')}`);
  }

  if (!preflight.ready) {
    console.log('');
    console.log(fail('Pre-flight check failed. Resolve issues above and retry.'));
    return false;
  }

  return true;
}

/**
 * Prepare OAuth binary and config
 */
async function prepareBinary(
  provider: CLIProxyProvider,
  verbose: boolean
): Promise<{ binaryPath: string; tokenDir: string; configPath: string } | null> {
  showStep(1, 4, 'progress', 'Preparing CLIProxy binary...');

  try {
    const binaryPath = await ensureCLIProxyBinary(verbose);
    process.stdout.write('\x1b[1A\x1b[2K');
    showStep(1, 4, 'ok', 'CLIProxy binary ready');

    const tokenDir = getProviderTokenDir(provider);
    fs.mkdirSync(tokenDir, { recursive: true, mode: 0o700 });

    const configPath = generateConfig(provider);
    if (verbose) {
      console.error(`[auth] Config generated: ${configPath}`);
    }

    return { binaryPath, tokenDir, configPath };
  } catch (error) {
    process.stdout.write('\x1b[1A\x1b[2K');
    showStep(1, 4, 'fail', 'Failed to prepare CLIProxy binary');
    console.error(fail((error as Error).message));
    throw error;
  }
}

/**
 * Handle paste-callback mode: show auth URL, prompt for callback paste
 * Uses proxy target resolver to connect to correct CLIProxyAPI instance (local or remote)
 */
async function handlePasteCallbackMode(
  provider: CLIProxyProvider,
  oauthConfig: ProviderOAuthConfig,
  verbose: boolean,
  tokenDir: string,
  nickname?: string
): Promise<AccountInfo | null> {
  // Resolve CLIProxyAPI target (local or remote based on config)
  const target = getProxyTarget();
  // OAuth state timeout (10 minutes, matches CLIProxyAPI state TTL)
  const OAUTH_STATE_TIMEOUT_MS = 10 * 60 * 1000;

  console.log('');
  console.log(info(`Starting ${oauthConfig.displayName} OAuth (paste-callback mode)...`));

  try {
    // Request auth URL from CLIProxyAPI.
    // Kiro keeps its legacy start route because CLI auth methods do not share the generic
    // management auth-url contract used by providers like Claude.
    let startData: PasteCallbackStartData;
    try {
      startData = await requestPasteCallbackStart(provider, target);
    } catch (error) {
      const startError = (error as Error).message;
      console.log(fail('Failed to start OAuth flow'));
      warnPossible403Ban(provider, startError);
      return null;
    }

    const authUrl = await resolvePasteCallbackAuthUrl(target, startData, OAUTH_STATE_TIMEOUT_MS);

    if (!authUrl) {
      console.log(fail('No authorization URL received'));
      return null;
    }

    // Display auth URL in box
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════════╗');
    console.log('  ║  Open this URL in any browser:                               ║');
    console.log('  ╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`    ${authUrl}`);
    console.log('');

    // Prompt for callback URL
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const callbackUrl = await new Promise<string | null>((resolve) => {
      let resolved = false;

      rl.on('close', () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });

      console.log(info('After completing authentication, paste the callback URL here:'));
      rl.question('> ', (answer) => {
        resolved = true;
        rl.close();
        resolve(answer.trim() || null);
      });

      // Timeout after 10 minutes (match state TTL)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          rl.close();
          console.log('');
          console.log(fail('Timed out waiting for callback URL (10 minutes)'));
          resolve(null);
        }
      }, OAUTH_STATE_TIMEOUT_MS);
    });

    if (!callbackUrl) {
      console.log(info('Cancelled'));
      return null;
    }

    // Validate callback URL
    let code: string | undefined;
    try {
      const parsed = new URL(callbackUrl);
      code = parsed.searchParams.get('code') || undefined;
    } catch {
      console.log(fail('Invalid URL format'));
      return null;
    }

    if (!code) {
      console.log(fail('Invalid callback URL: missing code parameter'));
      return null;
    }

    // Submit callback to CLIProxyAPI
    console.log(info('Submitting callback...'));

    const callbackProvider = CLIPROXY_CALLBACK_PROVIDER_MAP[provider] || provider;

    const callbackResponse = await fetch(buildProxyUrl(target, getManagementOAuthCallbackPath()), {
      method: 'POST',
      headers: buildManagementHeaders(target, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        provider: callbackProvider,
        redirect_url: callbackUrl,
      }),
    });

    const callbackData = (await callbackResponse.json()) as {
      status?: string;
      error?: string;
    };

    if (!callbackResponse.ok || callbackData.status === 'error') {
      const callbackError =
        callbackData.error || `OAuth callback failed with status ${callbackResponse.status}`;
      console.log(fail(callbackError));
      warnPossible403Ban(provider, callbackError);
      return null;
    }

    console.log(ok('Authentication successful!'));
    const account = registerAccountFromToken(provider, tokenDir, nickname);

    // Account safety: check for cross-provider conflicts
    if (account?.email) {
      const conflicts = checkNewAccountConflict(provider, account.email);
      if (conflicts) {
        warnNewAccountConflict(account.email, conflicts);
      }
    }

    return account;
  } catch (error) {
    if (verbose) {
      console.log(fail(`Error: ${(error as Error).message}`));
    } else {
      console.log(fail('OAuth failed. Use --verbose for details.'));
    }
    return null;
  }
}

/**
 * Trigger OAuth flow for provider
 * Auto-detects headless environment and uses --no-browser flag accordingly
 * Shows real-time step-by-step progress for better user feedback
 * Handles both Authorization Code (callback server) and Device Code (polling) flows
 */
export async function triggerOAuth(
  provider: CLIProxyProvider,
  options: OAuthOptions = {}
): Promise<AccountInfo | null> {
  const oauthConfig = getOAuthConfig(provider);
  warnOAuthBanRisk(provider);
  const { verbose = false, add = false, fromUI = false, noIncognito = true } = options;
  const acceptAgyRisk = options.acceptAgyRisk === true;
  let { nickname } = options;
  const resolvedKiroMethod =
    provider === 'kiro' ? normalizeKiroAuthMethod(options.kiroMethod) : DEFAULT_KIRO_AUTH_METHOD;

  if (provider === 'agy') {
    if (fromUI && !acceptAgyRisk) {
      console.log(fail('Antigravity OAuth blocked: responsibility acknowledgement is missing.'));
      return null;
    }

    if (!fromUI) {
      const acknowledged = await ensureCliAntigravityResponsibility({
        context: 'oauth',
        acceptedByFlag: acceptAgyRisk,
      });
      if (!acknowledged) {
        console.log(info('Cancelled'));
        return null;
      }
    }
  }

  // Check for existing accounts
  const existingAccounts = getProviderAccounts(provider);

  // Handle paste-callback mode
  if (options.pasteCallback) {
    const tokenDir = getProviderTokenDir(provider);
    return handlePasteCallbackMode(provider, oauthConfig, verbose, tokenDir, nickname);
  }

  // For kiro/ghcp: require nickname if not provided (CLI only, not fromUI)
  if (PROVIDERS_WITHOUT_EMAIL.includes(provider) && !nickname && !fromUI) {
    const promptedNickname = await promptNickname(provider, existingAccounts);
    if (!promptedNickname) {
      console.log(info('Cancelled'));
      return null;
    }
    nickname = promptedNickname;
  }

  // Handle --import flag: skip OAuth and import from Kiro IDE directly
  if (options.import && provider === 'kiro') {
    const tokenDir = getProviderTokenDir(provider);
    const success = await importKiroToken(verbose);
    if (success) {
      return registerAccountFromToken(provider, tokenDir, nickname);
    }
    return null;
  }

  if (provider === 'kiro' && resolvedKiroMethod === 'github') {
    console.log(fail('Kiro GitHub login is only available in Dashboard management OAuth flow.'));
    console.log('    Use: ccs config -> Accounts -> Add Kiro account -> Method: GitHub OAuth');
    return null;
  }

  const callbackPort =
    provider === 'kiro' ? getKiroCallbackPort(resolvedKiroMethod) : OAUTH_PORTS[provider];
  const isCLI = !fromUI;
  const headless = options.headless ?? isHeadlessEnvironment();
  const isDeviceCodeFlow =
    provider === 'kiro' ? isKiroDeviceCodeMethod(resolvedKiroMethod) : callbackPort === null;

  let authFlag = oauthConfig.authFlag;
  if (provider === 'kiro') {
    if (!isKiroCLIAuthMethod(resolvedKiroMethod)) {
      console.log(fail(`Kiro auth method '${resolvedKiroMethod}' is not supported by CLI flow.`));
      console.log('    Use Dashboard management OAuth for this method.');
      return null;
    }
    authFlag = getKiroCLIAuthFlag(resolvedKiroMethod);
  }

  // Interactive mode selection for headless environments
  // Skip if explicit mode flag provided or device code flow (no callback needed)
  if (headless && !options.pasteCallback && !options.portForward && !isDeviceCodeFlow) {
    // Non-interactive environment (piped input) - default to paste mode
    if (!process.stdin.isTTY) {
      const tokenDir = getProviderTokenDir(provider);
      return handlePasteCallbackMode(provider, oauthConfig, verbose, tokenDir, nickname);
    }
    const mode = await promptOAuthModeChoice(callbackPort);
    if (mode === 'paste') {
      const tokenDir = getProviderTokenDir(provider);
      return handlePasteCallbackMode(provider, oauthConfig, verbose, tokenDir, nickname);
    }
    // mode === 'forward' continues to existing port-forwarding flow below
  }

  if (existingAccounts.length > 0 && !add) {
    console.log('');
    console.log(
      info(
        `${existingAccounts.length} account(s) already authenticated for ${oauthConfig.displayName}`
      )
    );

    if (!(await promptAddAccount())) {
      console.log(info('Cancelled'));
      return null;
    }
  }

  // Pre-flight checks (skip for device code flows which don't need callback ports)
  if (!isDeviceCodeFlow && !(await runPreflightChecks(provider, oauthConfig))) {
    return null;
  }

  console.log('');

  // Prepare binary
  const prepared = await prepareBinary(provider, verbose);
  if (!prepared) return null;

  const { binaryPath, tokenDir, configPath } = prepared;

  // Free callback port if needed (only for authorization code flows)
  const localCallbackPort = callbackPort;
  if (localCallbackPort) {
    const killed = killProcessOnPort(localCallbackPort, verbose);
    if (killed && verbose) {
      console.error(`[auth] Freed port ${localCallbackPort} for OAuth callback`);
    }
  }

  // Build args
  const args = ['--config', configPath, authFlag];
  if (headless) {
    args.push('--no-browser');
  }
  // Kiro-specific: --no-incognito to use normal browser (saves login credentials)
  if (provider === 'kiro' && noIncognito) {
    args.push('--no-incognito');
  }

  // Show step based on flow type
  if (isDeviceCodeFlow) {
    showStep(2, 4, 'progress', `Starting ${oauthConfig.displayName} Device Code flow...`);
    console.log('');
    console.log(info('Device Code Flow - follow the instructions below'));
  } else {
    showStep(2, 4, 'progress', `Starting callback server on port ${callbackPort}...`);

    // Show headless instructions (only for authorization code flows)
    if (headless) {
      console.log('');
      console.log(warn('PORT FORWARDING REQUIRED'));
      console.log(`    OAuth callback uses localhost:${callbackPort} which must be reachable.`);
      console.log('    Run this on your LOCAL machine:');
      console.log(
        `    ${color(`ssh -L ${callbackPort}:localhost:${callbackPort} <USER>@<HOST>`, 'command')}`
      );
      console.log('');
    }
  }

  // Execute OAuth process
  const account = await executeOAuthProcess({
    provider,
    binaryPath,
    args,
    tokenDir,
    oauthConfig,
    callbackPort,
    headless,
    verbose,
    isCLI,
    nickname,
  });

  // Show hint for Kiro users about --no-incognito option (first-time auth only)
  if (account && provider === 'kiro' && !noIncognito) {
    console.log('');
    console.log(info('Tip: To save your AWS login credentials for future sessions:'));
    console.log('       Use: ccs kiro --no-incognito');
    console.log('       Or enable "Kiro: Use normal browser" in: ccs config');
  }

  // Account safety: check for cross-provider conflicts
  if (account?.email) {
    const conflicts = checkNewAccountConflict(provider, account.email);
    if (conflicts) {
      warnNewAccountConflict(account.email, conflicts);
    }
  }

  return account;
}

/**
 * Ensure provider is authenticated
 * Triggers OAuth flow if not authenticated
 */
export async function ensureAuth(
  provider: CLIProxyProvider,
  options: { verbose?: boolean; headless?: boolean; account?: string } = {}
): Promise<boolean> {
  if (isAuthenticated(provider)) {
    if (options.verbose) {
      console.error(`[auth] ${provider} already authenticated`);
    }
    const defaultAccount = getDefaultAccount(provider);
    if (defaultAccount) {
      touchAccount(provider, options.account || defaultAccount.id);
    }
    return true;
  }

  const oauthConfig = getOAuthConfig(provider);
  console.log(info(`${oauthConfig.displayName} authentication required`));

  const account = await triggerOAuth(provider, options);
  return account !== null;
}
