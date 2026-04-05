/**
 * OAuth Process Execution for CLIProxyAPI
 *
 * Handles the spawning and monitoring of CLIProxy OAuth process.
 * Separated from oauth-handler.ts for modularity.
 */

import { spawn, ChildProcess } from 'child_process';
import { ok, fail, info, warn } from '../../utils/ui';
import { killWithEscalation } from '../../utils/process-utils';
import { tryKiroImport } from './kiro-import';
import { CLIProxyProvider } from '../types';
import { AccountInfo } from '../account-manager';
import {
  parseProjectList,
  parseDefaultProject,
  isProjectSelectionPrompt,
  isProjectList,
  generateSessionId,
  requestProjectSelection,
  cancelProjectSelection,
  type GCloudProject,
  type ProjectSelectionPrompt,
} from '../project-selection-handler';
import { KiroAuthMethod, ProviderOAuthConfig } from './auth-types';
import { getTimeoutTroubleshooting, showStep } from './environment-detector';
import { isAuthenticated, registerAccountFromToken } from './token-manager';
import {
  deviceCodeEvents,
  DEVICE_CODE_TIMEOUT_MS,
  type DeviceCodePrompt,
} from '../device-code-handler';
import { OAUTH_FLOW_TYPES } from '../../management';
import {
  registerAuthSession,
  attachProcessToSession,
  unregisterAuthSession,
  authSessionEvents,
} from '../auth-session-manager';

/** Options for OAuth process execution */
export interface OAuthProcessOptions {
  provider: CLIProxyProvider;
  binaryPath: string;
  args: string[];
  tokenDir: string;
  oauthConfig: ProviderOAuthConfig;
  callbackPort: number | null;
  headless: boolean;
  verbose: boolean;
  isCLI: boolean;
  nickname?: string;
  expectedAccountId?: string;
  authFlowType?: 'device_code' | 'authorization_code';
  kiroMethod?: KiroAuthMethod;
  manualCallback?: boolean;
}

/** Internal state for OAuth process */
interface ProcessState {
  stderrData: string;
  urlDisplayed: boolean;
  browserOpened: boolean;
  projectPromptHandled: boolean;
  accumulatedOutput: string;
  parsedProjects: GCloudProject[];
  sessionId: string;
  /** Device code displayed to user (for Device Code Flow) */
  deviceCodeDisplayed: boolean;
  /** The user code to enter at verification URL */
  userCode: string | null;
  kiroMethodSelectionHandled: boolean;
  manualCallbackPrompted: boolean;
}

/**
 * Handle project selection prompt
 */
async function handleProjectSelection(
  output: string,
  state: ProcessState,
  options: OAuthProcessOptions,
  authProcess: ChildProcess,
  log: (msg: string) => void
): Promise<void> {
  const defaultProjectId = parseDefaultProject(output) || '';

  if (state.parsedProjects.length > 0 && !options.isCLI) {
    log(`Requesting project selection from UI (session: ${state.sessionId})`);

    const prompt: ProjectSelectionPrompt = {
      sessionId: state.sessionId,
      provider: options.provider,
      projects: state.parsedProjects,
      defaultProjectId,
      supportsAll: output.includes('ALL'),
    };

    try {
      const selectedId = await requestProjectSelection(prompt);
      const response = selectedId || '';
      log(`User selected: ${response || '(default)'}`);
      authProcess.stdin?.write(response + '\n');
    } catch {
      log('Project selection failed, using default');
      authProcess.stdin?.write('\n');
    }
  } else {
    log('CLI mode or no projects, auto-selecting default');
    authProcess.stdin?.write('\n');
  }
}

function resolveAuthFlowType(options: OAuthProcessOptions): 'device_code' | 'authorization_code' {
  return options.authFlowType || OAUTH_FLOW_TYPES[options.provider] || 'authorization_code';
}

async function promptManualCallbackUrl(displayName: string): Promise<string | null> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string | null>((resolve) => {
    let settled = false;

    rl.on('close', () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });

    console.log('');
    console.log(info(`${displayName} is waiting for the OAuth callback.`));
    console.log('Paste the full callback URL after you finish the login in your browser.');
    rl.question('> ', (answer) => {
      settled = true;
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}

async function replayManualCallback(
  oauthConfig: ProviderOAuthConfig,
  authProcess: ChildProcess,
  output: string,
  verbose: boolean
): Promise<boolean> {
  if (!output.includes('http://') && !output.includes('https://')) {
    return false;
  }

  const callbackUrl = await promptManualCallbackUrl(oauthConfig.displayName);
  if (!callbackUrl) {
    console.log(info('Cancelled'));
    killWithEscalation(authProcess);
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    console.log(fail('Invalid callback URL format'));
    killWithEscalation(authProcess);
    return true;
  }

  if (!parsed.searchParams.get('code')) {
    console.log(fail('Invalid callback URL: missing code parameter'));
    killWithEscalation(authProcess);
    return true;
  }

  console.log(info('Replaying callback to the local auth server...'));

  try {
    const response = await fetch(callbackUrl);
    if (!response.ok && response.status >= 400) {
      console.log(fail(`OAuth callback failed with status ${response.status}`));
      killWithEscalation(authProcess);
      return true;
    }
    console.log(ok('Callback submitted. Waiting for token exchange...'));
  } catch (error) {
    if (verbose) {
      console.log(fail(`Failed to replay callback: ${(error as Error).message}`));
    } else {
      console.log(fail('Failed to replay callback to the local auth server'));
    }
    killWithEscalation(authProcess);
  }

  return true;
}

/**
 * Handle stdout data from OAuth process
 */
async function handleStdout(
  output: string,
  state: ProcessState,
  options: OAuthProcessOptions,
  authProcess: ChildProcess,
  log: (msg: string) => void
): Promise<void> {
  log(`stdout: ${output.trim()}`);
  state.accumulatedOutput += output;

  const flowType = resolveAuthFlowType(options);
  const isDeviceCodeFlow = flowType === 'device_code';

  if (
    options.provider === 'kiro' &&
    options.kiroMethod === 'aws' &&
    !state.kiroMethodSelectionHandled &&
    state.accumulatedOutput.includes('Select login method')
  ) {
    state.kiroMethodSelectionHandled = true;
    authProcess.stdin?.write('1\n');
    log('Auto-selected Kiro Builder ID flow');
  }

  // Parse project list when available
  if (isProjectList(state.accumulatedOutput) && state.parsedProjects.length === 0) {
    state.parsedProjects = parseProjectList(state.accumulatedOutput);
    log(`Parsed ${state.parsedProjects.length} projects`);
  }

  // Handle project selection prompt (Authorization Code flows only - Device Code has no stdin pipe)
  if (!isDeviceCodeFlow && !state.projectPromptHandled && isProjectSelectionPrompt(output)) {
    state.projectPromptHandled = true;
    await handleProjectSelection(output, state, options, authProcess, log);
  }

  // Handle Device Code Flow: parse and display user code
  if (isDeviceCodeFlow && !state.deviceCodeDisplayed) {
    // Parse device/user code from various formats:
    // "Enter code: XXXX-YYYY" or "code XXXX-YYYY" or "user code: XXXX-YYYY"
    const codeMatch = state.accumulatedOutput.match(
      /(?:enter\s+)?(?:user\s+)?code[:\s]+["']?([A-Z0-9]{4,8}[-\s]?[A-Z0-9]{4,8})["']?/i
    );
    const urlMatch = state.accumulatedOutput.match(/(https?:\/\/[^\s]+device[^\s]*)/i);

    if (codeMatch) {
      state.userCode = codeMatch[1].toUpperCase();
      state.deviceCodeDisplayed = true;
      log(`Parsed device code: ${state.userCode}`);

      const verificationUrl = urlMatch?.[1] || 'https://github.com/login/device';

      // Emit device code event for WebSocket broadcast to UI
      const deviceCodePrompt: DeviceCodePrompt = {
        sessionId: state.sessionId,
        provider: options.provider,
        userCode: state.userCode,
        verificationUrl,
        expiresAt: Date.now() + DEVICE_CODE_TIMEOUT_MS,
      };
      deviceCodeEvents.emit('deviceCode:received', deviceCodePrompt);

      // Display device code prominently in CLI
      console.log('');
      console.log('  ╔══════════════════════════════════════════════════════╗');
      console.log(`  ║  Enter this code: ${state.userCode.padEnd(35)}║`);
      console.log('  ╚══════════════════════════════════════════════════════╝');
      console.log('');
      console.log(info(`Open: ${verificationUrl}`));
      console.log('');

      // Update step display for device code flow
      process.stdout.write('\x1b[1A\x1b[2K');
      showStep(2, 4, 'ok', 'Device code received');
      showStep(3, 4, 'progress', 'Waiting for authorization...');
    }
  }

  // Detect callback server / browser (for Authorization Code flows only)
  if (
    !isDeviceCodeFlow &&
    !state.browserOpened &&
    (output.includes('listening') || output.includes('http'))
  ) {
    process.stdout.write('\x1b[1A\x1b[2K');
    showStep(2, 4, 'ok', `Callback server listening on port ${options.callbackPort}`);
    showStep(3, 4, 'progress', 'Opening browser...');
    state.browserOpened = true;
  }

  // Display OAuth URL for all modes (enables VS Code terminal URL detection popup)
  if (!isDeviceCodeFlow && !state.urlDisplayed) {
    const urlMatch = output.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      console.log('');
      console.log(info(`${options.oauthConfig.displayName} OAuth URL:`));
      console.log(`    ${urlMatch[0]}`);
      console.log('');
      state.urlDisplayed = true;

      if (options.manualCallback && !state.manualCallbackPrompted) {
        state.manualCallbackPrompted = true;
        await replayManualCallback(options.oauthConfig, authProcess, urlMatch[0], options.verbose);
      }
    }
  }
}

/** Display OAuth URL from stderr if in headless mode */
function displayUrlFromStderr(
  output: string,
  state: ProcessState,
  oauthConfig: ProviderOAuthConfig
): void {
  const urlMatch = output.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    console.log('');
    console.log(info(`${oauthConfig.displayName} OAuth URL:`));
    console.log(`    ${urlMatch[0]}`);
    console.log('');
    state.urlDisplayed = true;
  }
}

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;

export function extractLikelyAuthFailureFromStderr(
  provider: CLIProxyProvider,
  stderrData: string
): string | null {
  // Keep this scoped to ghcp to avoid over-classifying other providers.
  if (provider !== 'ghcp') {
    return null;
  }

  if (!stderrData.trim()) {
    return null;
  }

  const normalizedLines = stderrData
    .split('\n')
    .map((line) => line.replace(ANSI_ESCAPE_REGEX, '').trim())
    .filter(Boolean)
    .map((line) => {
      const messageIndex = line.indexOf('msg="');
      if (messageIndex >= 0) {
        const message = line
          .slice(messageIndex + 5)
          .replace(/"$/, '')
          .trim();
        if (message) {
          return message;
        }
      }
      return line;
    });

  const prioritizedPatterns = [
    /github copilot authentication failed:\s*(.+)/i,
    /authentication failed:\s*(.+)/i,
    /failed to verify copilot access[^:]*:\s*(.+)/i,
    /failed to save auth:\s*(.+)/i,
  ];

  for (let i = normalizedLines.length - 1; i >= 0; i--) {
    const line = normalizedLines[i];
    for (const pattern of prioritizedPatterns) {
      const match = line.match(pattern);
      if (match?.[1]?.trim()) {
        return match[1].trim().slice(0, 240);
      }
    }
  }

  return null;
}

/** Handle token not found after successful process exit */
async function handleTokenNotFound(
  provider: CLIProxyProvider,
  callbackPort: number | null,
  tokenDir: string,
  nickname: string | undefined,
  expectedAccountId: string | undefined,
  verbose: boolean,
  failureReason?: string
): Promise<AccountInfo | null> {
  // Kiro-specific: Try auto-import from Kiro IDE
  if (provider === 'kiro') {
    console.log('');
    console.log(warn('Callback redirected to Kiro IDE. Attempting to import token...'));

    const result = await tryKiroImport(tokenDir, verbose);

    if (result.success) {
      const providerInfo = result.provider ? ` (Provider: ${result.provider})` : '';
      console.log(ok(`Imported Kiro token from IDE${providerInfo}`));
      return registerAccountFromToken(provider, tokenDir, nickname, verbose, expectedAccountId);
    }

    console.log(fail(`Auto-import failed: ${result.error}`));
    console.log('');
    console.log('To manually import from Kiro IDE:');
    console.log('  1. Ensure you are logged into Kiro IDE');
    console.log('  2. Run: ccs kiro --import');
    return null;
  }

  // Default behavior for other providers
  console.log('');

  if (failureReason) {
    // Sanitize internal URLs/paths from failure reason to avoid leaking infrastructure details
    const sanitizedReason = failureReason
      .replace(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[^\s]*/gi, '[internal-url]')
      .replace(/\/(?:root|home|opt|tmp|var)\/[^\s]*/g, '[path]');
    console.log(fail('Authentication completed but token was not persisted'));
    console.log(`    ${sanitizedReason}`);
    console.log('');
    console.log('This usually means provider-side authorization was accepted,');
    console.log('but CLIProxy failed a post-auth verification or token save step.');
    console.log('');
    console.log(`Try: ccs ${provider} --auth --verbose`);
    return null;
  }

  console.log(fail('Token not found after authentication'));
  console.log('');
  console.log('The browser showed success but callback was not received.');
  console.log('');
  console.log('Common causes:');
  console.log('  1. OAuth session timed out (sessions expire after ~10 minutes)');
  console.log('  2. Callback server could not receive the redirect');
  console.log('  3. Browser did not redirect to localhost properly');

  if (process.platform === 'win32') {
    console.log('');
    console.log('On Windows, this usually means:');
    console.log('  1. Windows Firewall blocked the callback');
    console.log('  2. Antivirus software blocked the connection');
    console.log('');
    console.log('Try running as Administrator:');
    console.log(
      `  netsh advfirewall firewall add rule name="CCS OAuth" dir=in action=allow protocol=TCP localport=${callbackPort}`
    );
  }

  console.log('');
  console.log('If you copied the OAuth URL to a different browser:');
  console.log('  - Complete authentication within the timeout window');
  console.log('  - Ensure you are on the same machine (localhost callback)');
  console.log('  - Copy the entire URL including all parameters');
  console.log('');
  console.log(`Try: ccs ${provider} --auth --verbose`);
  return null;
}

/** Handle process exit with error */
function handleProcessError(code: number | null, state: ProcessState, headless: boolean): void {
  console.log('');
  console.log(fail(`CLIProxy auth exited with code ${code}`));
  if (state.stderrData && !state.urlDisplayed) {
    console.log(`    ${state.stderrData.trim().split('\n')[0]}`);
  }
  if (headless && !state.urlDisplayed) {
    console.log('');
    console.log(info('No OAuth URL was displayed. Try with --verbose for details.'));
  }
}

/**
 * Execute OAuth process and wait for completion
 */
export function executeOAuthProcess(options: OAuthProcessOptions): Promise<AccountInfo | null> {
  const {
    provider,
    binaryPath,
    args,
    tokenDir,
    oauthConfig,
    callbackPort,
    headless,
    verbose,
    nickname,
    expectedAccountId,
  } = options;

  const log = (msg: string) => {
    if (verbose) console.error(`[auth] ${msg}`);
  };

  return new Promise<AccountInfo | null>((resolve) => {
    const flowType = resolveAuthFlowType(options);
    const isDeviceCodeFlow = flowType === 'device_code';

    // Device-code flows can usually inherit stdin, but Kiro's default AWS flow now
    // prints an intermediate Builder ID vs IDC selector that CCS auto-answers.
    const stdinMode =
      isDeviceCodeFlow &&
      process.stdin.isTTY &&
      !(provider === 'kiro' && options.kiroMethod === 'aws')
        ? 'inherit'
        : 'pipe';

    const authProcess = spawn(binaryPath, args, {
      stdio: [stdinMode, 'pipe', 'pipe'],
      env: { ...process.env, CLI_PROXY_AUTH_DIR: tokenDir },
    });

    // H7: Mutable ref for stdin keepalive interval (set later, needed in cleanup)
    let stdinKeepalive: ReturnType<typeof setInterval> | null = null;

    // H5: Signal handling - properly kill child process on SIGINT/SIGTERM
    // H8: Also clear stdinKeepalive interval to prevent memory leak
    const cleanup = () => {
      if (stdinKeepalive) clearInterval(stdinKeepalive);
      if (authProcess && authProcess.exitCode === null) {
        killWithEscalation(authProcess);
      }
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    const state: ProcessState = {
      stderrData: '',
      urlDisplayed: false,
      browserOpened: false,
      projectPromptHandled: false,
      accumulatedOutput: '',
      parsedProjects: [],
      sessionId: generateSessionId(),
      deviceCodeDisplayed: false,
      userCode: null,
      kiroMethodSelectionHandled: false,
      manualCallbackPrompted: false,
    };

    // Register session for cancellation support
    registerAuthSession(state.sessionId, provider);
    attachProcessToSession(state.sessionId, authProcess);

    // Listen for external cancel signal
    const handleCancel = (cancelledSessionId: string) => {
      if (cancelledSessionId === state.sessionId && authProcess && authProcess.exitCode === null) {
        log('Session cancelled externally');
        killWithEscalation(authProcess);
      }
    };
    authSessionEvents.on('session:cancelled', handleCancel);

    const startTime = Date.now();

    // H7: Stdin keepalive for Authorization Code flows
    // CLIProxyAPIPlus has a 15-second timer that prompts for manual URL paste.
    // If the user completes browser auth after this timer fires but before the
    // non-blocking check, the prompt blocks forever on stdin.
    // Workaround: Send newline every 16s to skip the manual prompt and continue polling.
    if (!isDeviceCodeFlow && stdinMode === 'pipe') {
      stdinKeepalive = setInterval(() => {
        if (authProcess.stdin && !authProcess.stdin.destroyed) {
          authProcess.stdin.write('\n');
          log('Sent stdin keepalive (skip manual URL prompt)');
        }
      }, 16000);
    }

    authProcess.stdout?.on('data', async (data: Buffer) => {
      await handleStdout(data.toString(), state, options, authProcess, log);
    });

    authProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      state.stderrData += output;
      log(`stderr: ${output.trim()}`);
      if (headless && !state.urlDisplayed) {
        displayUrlFromStderr(output, state, oauthConfig);
      }
    });

    // Show waiting message after delay
    setTimeout(() => {
      if (isDeviceCodeFlow) {
        // Device Code Flow: show polling message
        if (!state.deviceCodeDisplayed) {
          // Code not yet displayed, show generic waiting message
          showStep(3, 4, 'progress', 'Waiting for device code...');
        }
        showStep(4, 4, 'progress', 'Polling for authorization...');
        console.log('');
        console.log(
          info('Complete the login in your browser. This page will update automatically.')
        );
      } else {
        // Authorization Code Flow: show callback server message
        if (!state.browserOpened) {
          process.stdout.write('\x1b[1A\x1b[2K');
          showStep(2, 4, 'ok', `Callback server ready (port ${callbackPort})`);
          showStep(3, 4, 'ok', 'Browser opened');
          state.browserOpened = true;
        }
        showStep(4, 4, 'progress', 'Waiting for OAuth callback...');
        console.log('');
        console.log(
          info('Complete the login in your browser. This page will update automatically.')
        );
      }
      if (!verbose) console.log(info('If stuck, try: ccs ' + provider + ' --auth --verbose'));
    }, 2000);

    // Timeout handling
    // Device code flows need longer timeout to match CLIProxy binary's polling window (60 attempts × 5s = 300s)
    const timeoutMs = headless || isDeviceCodeFlow ? 300000 : 120000;
    const timeout = setTimeout(() => {
      // H7: Clear stdin keepalive interval
      if (stdinKeepalive) clearInterval(stdinKeepalive);
      // H5: Remove signal handlers before killing process
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      authSessionEvents.removeListener('session:cancelled', handleCancel);
      unregisterAuthSession(state.sessionId);
      cancelProjectSelection(state.sessionId);
      killWithEscalation(authProcess);
      console.log('');
      console.log(fail(`OAuth timed out after ${timeoutMs / 60000} minutes`));
      for (const line of getTimeoutTroubleshooting(provider, callbackPort ?? null)) {
        console.log(line);
      }
      resolve(null);
    }, timeoutMs);

    authProcess.on('exit', async (code) => {
      clearTimeout(timeout);
      // H7: Clear stdin keepalive interval
      if (stdinKeepalive) clearInterval(stdinKeepalive);
      // H5: Remove signal handlers to prevent memory leaks
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      authSessionEvents.removeListener('session:cancelled', handleCancel);
      unregisterAuthSession(state.sessionId);
      cancelProjectSelection(state.sessionId);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (code === 0) {
        if (isAuthenticated(provider)) {
          console.log('');
          console.log(ok(`Authentication successful (${elapsed}s)`));

          // Emit device code completion event for UI
          if (isDeviceCodeFlow && state.deviceCodeDisplayed) {
            deviceCodeEvents.emit('deviceCode:completed', state.sessionId);
          }

          resolve(
            registerAccountFromToken(provider, tokenDir, nickname, verbose, expectedAccountId)
          );
        } else {
          const failureReason = extractLikelyAuthFailureFromStderr(provider, state.stderrData);

          // Emit device code failure event for UI
          if (isDeviceCodeFlow && state.deviceCodeDisplayed) {
            deviceCodeEvents.emit('deviceCode:failed', {
              sessionId: state.sessionId,
              error: failureReason || 'Token not found after authentication',
            });
          }

          // Try auto-import for Kiro, show error for others
          const account = await handleTokenNotFound(
            provider,
            callbackPort,
            tokenDir,
            nickname,
            expectedAccountId,
            verbose,
            failureReason || undefined
          );
          resolve(account);
        }
      } else {
        // Emit device code failure event for UI
        if (isDeviceCodeFlow && state.deviceCodeDisplayed) {
          deviceCodeEvents.emit('deviceCode:failed', {
            sessionId: state.sessionId,
            error: `Auth process exited with code ${code}`,
          });
        }

        handleProcessError(code, state, headless);
        resolve(null);
      }
    });

    authProcess.on('error', (error) => {
      clearTimeout(timeout);
      // H7: Clear stdin keepalive interval
      if (stdinKeepalive) clearInterval(stdinKeepalive);
      // H5: Remove signal handlers to prevent memory leaks
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      authSessionEvents.removeListener('session:cancelled', handleCancel);
      unregisterAuthSession(state.sessionId);
      cancelProjectSelection(state.sessionId);
      console.log('');
      console.log(fail(`Failed to start auth process: ${error.message}`));
      resolve(null);
    });
  });
}
