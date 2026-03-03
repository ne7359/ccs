import { Router, Request, Response } from 'express';
import {
  getAllAuthStatus,
  getOAuthConfig,
  initializeAccounts,
  triggerOAuth,
} from '../../cliproxy/auth-handler';
import {
  submitProjectSelection,
  getPendingSelection,
} from '../../cliproxy/project-selection-handler';
import {
  cancelAllSessionsForProvider,
  hasActiveSession,
} from '../../cliproxy/auth-session-manager';
import { fetchCliproxyStats } from '../../cliproxy/stats-fetcher';
import {
  getAllAccountsSummary,
  getProviderAccounts,
  setDefaultAccount as setDefaultAccountFn,
  removeAccount as removeAccountFn,
  pauseAccount as pauseAccountFn,
  resumeAccount as resumeAccountFn,
  touchAccount,
  PROVIDERS_WITHOUT_EMAIL,
  validateNickname,
} from '../../cliproxy/account-manager';
import {
  getProxyTarget,
  buildProxyUrl,
  buildManagementHeaders,
} from '../../cliproxy/proxy-target-resolver';
import { fetchRemoteAuthStatus } from '../../cliproxy/remote-auth-fetcher';
import { loadOrCreateUnifiedConfig } from '../../config/unified-config-loader';
import { tryKiroImport } from '../../cliproxy/auth/kiro-import';
import { getProviderTokenDir } from '../../cliproxy/auth/token-manager';
import {
  CLIPROXY_CALLBACK_PROVIDER_MAP,
  CLIPROXY_AUTH_URL_PROVIDER_MAP,
  isKiroAuthMethod,
  isKiroDeviceCodeMethod,
  KiroAuthMethod,
  normalizeKiroAuthMethod,
  toKiroManagementMethod,
} from '../../cliproxy/auth/auth-types';
import { getOAuthFlowType } from '../../cliproxy/provider-capabilities';
import type { CLIProxyProvider } from '../../cliproxy/types';
import { CLIPROXY_PROFILES } from '../../auth/profile-detector';
import {
  validateAntigravityRiskAcknowledgement,
  isAntigravityResponsibilityBypassEnabled,
} from '../../cliproxy/antigravity-responsibility';

const router = Router();

// Valid providers list - derived from canonical CLIPROXY_PROFILES
const validProviders: CLIProxyProvider[] = [...CLIPROXY_PROFILES];

function logRouteError(context: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[cliproxy-auth-routes] ${context}: ${error.message}`);
    return;
  }
  console.error(`[cliproxy-auth-routes] ${context}: unknown error`);
}

function respondInternalError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
  statusCode = 500
): void {
  logRouteError(fallbackMessage, error);
  res.status(statusCode).json({ error: fallbackMessage });
}

function parseKiroMethod(raw: unknown): { method: KiroAuthMethod; invalid: boolean } {
  if (raw === undefined || raw === null) {
    return { method: normalizeKiroAuthMethod(), invalid: false };
  }
  if (typeof raw !== 'string') {
    return { method: normalizeKiroAuthMethod(), invalid: true };
  }
  if (raw.trim() === '') {
    return { method: normalizeKiroAuthMethod(), invalid: false };
  }
  const normalized = raw.trim().toLowerCase();
  if (!isKiroAuthMethod(normalized)) {
    return { method: normalizeKiroAuthMethod(), invalid: true };
  }
  return { method: normalizeKiroAuthMethod(normalized), invalid: false };
}

export function getStartUrlUnsupportedReason(
  provider: CLIProxyProvider,
  options?: { kiroMethod?: KiroAuthMethod }
): string | null {
  if (provider === 'kiro') {
    const kiroMethod = options?.kiroMethod ?? normalizeKiroAuthMethod();
    if (kiroMethod === 'aws-authcode') {
      return "Kiro method 'aws-authcode' uses CLI auth flow. Use /api/cliproxy/auth/kiro/start instead.";
    }
    if (isKiroDeviceCodeMethod(kiroMethod)) {
      return "Kiro method 'aws' uses Device Code flow. Use /api/cliproxy/auth/kiro/start instead.";
    }
    return null;
  }

  if (getOAuthFlowType(provider) === 'device_code') {
    return `Provider '${provider}' uses Device Code flow. Use /api/cliproxy/auth/${provider}/start instead.`;
  }
  return null;
}

export function getStartAuthFailureMessage(provider: CLIProxyProvider): string {
  if (provider === 'ghcp') {
    return 'Authentication failed, was cancelled, or GitHub Copilot verification did not complete. Ensure the account has an active Copilot subscription and retry.';
  }
  return 'Authentication failed or was cancelled';
}

/**
 * GET /api/cliproxy/auth - Get auth status for built-in CLIProxy profiles
 * Also fetches CLIProxyAPI stats to update lastUsedAt for active providers
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Check if remote mode is enabled
    const target = getProxyTarget();
    if (target.isRemote) {
      const authStatus = await fetchRemoteAuthStatus(target);
      res.json({ authStatus, source: 'remote' });
      return;
    }

    // Local mode: Initialize accounts from existing tokens on first request
    initializeAccounts();

    // Fetch CLIProxyAPI usage stats to determine active providers
    const stats = await fetchCliproxyStats();

    // Map CLIProxyAPI provider names to our internal provider names
    const statsProviderMap: Record<string, CLIProxyProvider> = {
      gemini: 'gemini',
      antigravity: 'agy',
      codex: 'codex',
      qwen: 'qwen',
      iflow: 'iflow',
      kiro: 'kiro',
      copilot: 'ghcp', // CLIProxyAPI returns 'copilot', we map to 'ghcp'
      anthropic: 'claude', // CLIProxyAPI returns 'anthropic', we map to 'claude'
      claude: 'claude',
    };

    // Update lastUsedAt for providers with recent activity
    if (stats?.requestsByProvider) {
      for (const [statsProvider, requestCount] of Object.entries(stats.requestsByProvider)) {
        if (requestCount > 0) {
          const provider = statsProviderMap[statsProvider.toLowerCase()];
          if (provider) {
            // Touch the default account for this provider (or all accounts)
            const accounts = getProviderAccounts(provider);
            for (const account of accounts) {
              // Only touch if this is the default account (most likely being used)
              if (account.isDefault) {
                touchAccount(provider, account.id);
              }
            }
          }
        }
      }
    }

    const statuses = getAllAuthStatus();

    const authStatus = statuses.map((status) => {
      const oauthConfig = getOAuthConfig(status.provider);
      return {
        provider: status.provider,
        displayName: oauthConfig.displayName,
        authenticated: status.authenticated,
        lastAuth: status.lastAuth?.toISOString() || null,
        tokenFiles: status.tokenFiles.length,
        accounts: status.accounts,
        defaultAccount: status.defaultAccount,
      };
    });

    res.json({ authStatus });
  } catch (error) {
    // Return appropriate error for remote vs local mode
    const target = getProxyTarget();
    if (target.isRemote) {
      res.status(503).json({
        error: 'Failed to fetch remote auth status',
        authStatus: [],
        source: 'remote',
      });
    } else {
      respondInternalError(res, error, 'Failed to fetch auth status.');
    }
  }
});

// ==================== Account Management ====================

/**
 * GET /api/cliproxy/accounts - Get all accounts across all providers
 */
router.get('/accounts', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Check if remote mode is enabled
    const target = getProxyTarget();
    if (target.isRemote) {
      const authStatus = await fetchRemoteAuthStatus(target);
      const accounts = authStatus.flatMap((status) => status.accounts);
      res.json({ accounts, source: 'remote' });
      return;
    }

    // Local mode: Initialize accounts from existing tokens
    initializeAccounts();

    const accounts = getAllAccountsSummary();
    res.json({ accounts });
  } catch (error) {
    const target = getProxyTarget();
    if (target.isRemote) {
      res.status(503).json({
        error: 'Failed to fetch remote account status',
        accounts: [],
        source: 'remote',
      });
    } else {
      respondInternalError(res, error, 'Failed to list accounts.');
    }
  }
});

/**
 * GET /api/cliproxy/accounts/:provider - Get accounts for a specific provider
 */
router.get('/accounts/:provider', (req: Request, res: Response): void => {
  const { provider } = req.params;

  // Validate provider
  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  try {
    const accounts = getProviderAccounts(provider as CLIProxyProvider);
    res.json({ provider, accounts });
  } catch (error) {
    respondInternalError(res, error, 'Failed to get provider accounts.');
  }
});

/**
 * POST /api/cliproxy/accounts/:provider/default - Set default account for provider
 */
router.post('/accounts/:provider/default', (req: Request, res: Response): void => {
  // Check if remote mode is enabled - account management not available
  const target = getProxyTarget();
  if (target.isRemote) {
    res.status(501).json({
      error: 'Account management not available in remote mode',
    });
    return;
  }

  const { provider } = req.params;
  const { accountId } = req.body;

  if (!accountId) {
    res.status(400).json({ error: 'Missing required field: accountId' });
    return;
  }

  // Validate provider
  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  try {
    const success = setDefaultAccountFn(provider as CLIProxyProvider, accountId);

    if (success) {
      res.json({ provider, defaultAccount: accountId });
    } else {
      res
        .status(404)
        .json({ error: `Account '${accountId}' not found for provider '${provider}'` });
    }
  } catch (error) {
    respondInternalError(res, error, 'Failed to set default account.');
  }
});

/**
 * DELETE /api/cliproxy/accounts/:provider/:accountId - Remove an account
 */
router.delete('/accounts/:provider/:accountId', (req: Request, res: Response): void => {
  // Check if remote mode is enabled - account management not available
  const target = getProxyTarget();
  if (target.isRemote) {
    res.status(501).json({
      error: 'Account management not available in remote mode',
    });
    return;
  }

  const { provider, accountId } = req.params;

  // Validate provider
  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  try {
    const success = removeAccountFn(provider as CLIProxyProvider, accountId);

    if (success) {
      res.json({ provider, accountId, deleted: true });
    } else {
      res
        .status(404)
        .json({ error: `Account '${accountId}' not found for provider '${provider}'` });
    }
  } catch (error) {
    respondInternalError(res, error, 'Failed to remove account.');
  }
});

/**
 * POST /api/cliproxy/accounts/:provider/:accountId/pause - Pause an account
 * Paused accounts are skipped during quota rotation
 */
router.post('/accounts/:provider/:accountId/pause', (req: Request, res: Response): void => {
  const target = getProxyTarget();
  if (target.isRemote) {
    res.status(501).json({ error: 'Account management not available in remote mode' });
    return;
  }

  const { provider, accountId } = req.params;

  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  try {
    const success = pauseAccountFn(provider as CLIProxyProvider, accountId);
    if (success) {
      res.json({ provider, accountId, paused: true });
    } else {
      res
        .status(404)
        .json({ error: `Account '${accountId}' not found for provider '${provider}'` });
    }
  } catch (error) {
    respondInternalError(res, error, 'Failed to pause account.');
  }
});

/**
 * POST /api/cliproxy/accounts/:provider/:accountId/resume - Resume a paused account
 */
router.post('/accounts/:provider/:accountId/resume', (req: Request, res: Response): void => {
  const target = getProxyTarget();
  if (target.isRemote) {
    res.status(501).json({ error: 'Account management not available in remote mode' });
    return;
  }

  const { provider, accountId } = req.params;

  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  try {
    const success = resumeAccountFn(provider as CLIProxyProvider, accountId);
    if (success) {
      res.json({ provider, accountId, paused: false });
    } else {
      res
        .status(404)
        .json({ error: `Account '${accountId}' not found for provider '${provider}'` });
    }
  } catch (error) {
    respondInternalError(res, error, 'Failed to resume account.');
  }
});

/**
 * POST /api/cliproxy/auth/:provider/start - Start OAuth flow for a provider
 * Opens browser for authentication and returns account info when complete
 */
router.post('/:provider/start', async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.params;
  const requestBody =
    req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const nicknameRaw = typeof requestBody.nickname === 'string' ? requestBody.nickname : undefined;
  const noIncognitoBody =
    typeof requestBody.noIncognito === 'boolean' ? requestBody.noIncognito : undefined;
  const kiroMethodRaw = requestBody.kiroMethod;
  const riskAcknowledgement = requestBody.riskAcknowledgement;
  const target = getProxyTarget();
  if (target.isRemote) {
    res.status(501).json({ error: 'OAuth start flow not available in remote mode' });
    return;
  }
  // Trim nickname for consistency with CLI (oauth-handler.ts trims input)
  const nickname = nicknameRaw?.trim();
  const { method: kiroMethod, invalid: invalidKiroMethod } = parseKiroMethod(kiroMethodRaw);

  // Validate provider
  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  if (provider === 'kiro' && invalidKiroMethod) {
    res.status(400).json({
      error: 'Invalid kiroMethod. Supported: aws, aws-authcode, google, github',
      code: 'INVALID_KIRO_METHOD',
    });
    return;
  }

  if (provider === 'agy' && !isAntigravityResponsibilityBypassEnabled()) {
    const validation = validateAntigravityRiskAcknowledgement(riskAcknowledgement);
    if (!validation.valid) {
      res.status(400).json({
        error: validation.error,
        code: 'AGY_RISK_ACK_REQUIRED',
      });
      return;
    }
  }

  // For kiro/ghcp: nickname is required
  if (PROVIDERS_WITHOUT_EMAIL.includes(provider as CLIProxyProvider)) {
    if (!nickname) {
      res.status(400).json({
        error: `Nickname is required for ${provider} accounts. Please provide a unique nickname.`,
        code: 'NICKNAME_REQUIRED',
      });
      return;
    }

    const validationError = validateNickname(nickname);
    if (validationError) {
      res.status(400).json({
        error: validationError,
        code: 'INVALID_NICKNAME',
      });
      return;
    }

    // Check uniqueness
    const existingAccounts = getProviderAccounts(provider as CLIProxyProvider);
    const existingNicknames = existingAccounts.map(
      (a) => a.nickname?.toLowerCase() || a.id.toLowerCase()
    );
    if (existingNicknames.includes(nickname.toLowerCase())) {
      res.status(400).json({
        error: `Nickname "${nickname}" is already in use. Choose a different one.`,
        code: 'NICKNAME_EXISTS',
      });
      return;
    }
  }

  // Check Kiro no-incognito setting from config (or request body)
  // Default to true (use normal browser) for reliability - incognito often fails
  let noIncognito = true;
  if (provider === 'kiro') {
    const config = loadOrCreateUnifiedConfig();
    noIncognito = noIncognitoBody ?? config.cliproxy?.kiro_no_incognito ?? true;
  }

  try {
    // Trigger OAuth flow - this opens browser and waits for completion
    const account = await triggerOAuth(provider as CLIProxyProvider, {
      add: true, // Always add mode from UI
      headless: false, // Force interactive mode
      nickname: nickname || undefined,
      acceptAgyRisk: provider === 'agy',
      kiroMethod: provider === 'kiro' ? kiroMethod : undefined,
      fromUI: true, // Enable project selection prompt in UI
      noIncognito, // Kiro: use normal browser if enabled
    });

    if (account) {
      res.json({
        success: true,
        account: {
          id: account.id,
          email: account.email,
          nickname: account.nickname,
          provider: account.provider,
          isDefault: account.isDefault,
        },
      });
    } else {
      res.status(400).json({
        error: getStartAuthFailureMessage(provider as CLIProxyProvider),
      });
    }
  } catch (error) {
    respondInternalError(res, error, 'Failed to start OAuth flow.');
  }
});

/**
 * POST /api/cliproxy/auth/:provider/cancel - Cancel in-progress OAuth flow
 * Terminates the OAuth process for the specified provider
 */
router.post('/:provider/cancel', (req: Request, res: Response): void => {
  const { provider } = req.params;

  // Validate provider
  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  // Check if there's an active session
  if (!hasActiveSession(provider)) {
    res.status(404).json({ error: 'No active authentication session for this provider' });
    return;
  }

  // Cancel all sessions for this provider
  const cancelledCount = cancelAllSessionsForProvider(provider);

  res.json({
    success: true,
    cancelled: cancelledCount,
    provider,
  });
});

/**
 * GET /api/cliproxy/auth/project-selection/:sessionId - Get pending project selection prompt
 * Returns project list for user to select from during OAuth flow
 */
router.get('/project-selection/:sessionId', (req: Request, res: Response): void => {
  const { sessionId } = req.params;

  const pending = getPendingSelection(sessionId);
  if (pending) {
    res.json(pending);
  } else {
    res.status(404).json({ error: 'No pending project selection for this session' });
  }
});

/**
 * POST /api/cliproxy/auth/project-selection/:sessionId - Submit project selection
 * Submits user's project choice during OAuth flow
 */
router.post('/project-selection/:sessionId', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const { selectedId } = req.body;

  if (!selectedId && selectedId !== '') {
    res.status(400).json({ error: 'selectedId is required (use empty string for default)' });
    return;
  }

  const success = submitProjectSelection({ sessionId, selectedId });
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'No pending project selection for this session' });
  }
});

/**
 * POST /api/cliproxy/auth/kiro/import - Import Kiro token from Kiro IDE
 * Alternative auth path when OAuth callback fails to redirect properly
 */
router.post('/kiro/import', async (_req: Request, res: Response): Promise<void> => {
  // Check if remote mode is enabled - import not available remotely
  const target = getProxyTarget();
  if (target.isRemote) {
    res.status(501).json({
      error: 'Kiro import not available in remote mode',
    });
    return;
  }

  try {
    const tokenDir = getProviderTokenDir('kiro');
    const result = await tryKiroImport(tokenDir, false);

    if (result.success) {
      // Re-initialize accounts to pick up new token
      initializeAccounts();

      // Get the newly added account
      const accounts = getProviderAccounts('kiro');
      const newAccount = accounts.find((a) => a.isDefault) || accounts[0];

      res.json({
        success: true,
        account: newAccount
          ? {
              id: newAccount.id,
              email: newAccount.email,
              provider: 'kiro',
              isDefault: newAccount.isDefault,
            }
          : null,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to import Kiro token',
      });
    }
  } catch (error) {
    respondInternalError(res, error, 'Failed to import Kiro token.');
  }
});

// ==================== Manual Callback Submission ====================

/**
 * POST /api/cliproxy/auth/:provider/start-url - Start OAuth and return auth URL immediately
 * Unlike /start which blocks until completion, this returns the URL for manual callback flow
 */
router.post('/:provider/start-url', async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.params;
  const { kiroMethod: kiroMethodRaw, riskAcknowledgement } = req.body ?? {};
  const { method: kiroMethod, invalid: invalidKiroMethod } = parseKiroMethod(kiroMethodRaw);

  // Check remote mode
  const target = getProxyTarget();
  if (target.isRemote) {
    res.status(501).json({ error: 'Manual OAuth flow not available in remote mode' });
    return;
  }

  // Validate provider
  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  if (provider === 'kiro' && invalidKiroMethod) {
    res.status(400).json({
      error: 'Invalid kiroMethod. Supported: aws, aws-authcode, google, github',
      code: 'INVALID_KIRO_METHOD',
    });
    return;
  }

  if (provider === 'agy' && !isAntigravityResponsibilityBypassEnabled()) {
    const validation = validateAntigravityRiskAcknowledgement(riskAcknowledgement);
    if (!validation.valid) {
      res.status(400).json({
        error: validation.error,
        code: 'AGY_RISK_ACK_REQUIRED',
      });
      return;
    }
  }

  const unsupportedReason = getStartUrlUnsupportedReason(provider as CLIProxyProvider, {
    kiroMethod: provider === 'kiro' ? kiroMethod : undefined,
  });
  if (unsupportedReason) {
    res.status(400).json({ error: unsupportedReason });
    return;
  }

  try {
    const authUrlProvider =
      CLIPROXY_AUTH_URL_PROVIDER_MAP[provider as CLIProxyProvider] || provider;
    const kiroQuery =
      provider === 'kiro'
        ? `&method=${encodeURIComponent(toKiroManagementMethod(kiroMethod))}`
        : '';

    // Call CLIProxyAPI to start OAuth and get auth URL
    // CLIProxyAPI management routes are under /v0/management prefix
    const response = await fetch(
      buildProxyUrl(target, `/v0/management/${authUrlProvider}-auth-url?is_webui=true${kiroQuery}`),
      { headers: buildManagementHeaders(target) }
    );

    if (!response.ok) {
      const error = await response.text();
      res.status(response.status).json({ error: error || 'Failed to start OAuth' });
      return;
    }

    const data = (await response.json()) as {
      url?: string;
      auth_url?: string;
      state?: string;
      method?: string;
    };
    const authUrl = data.url || data.auth_url;

    // Some upstream flows return state first and provide auth_url in subsequent status polling.
    if (!authUrl && !data.state) {
      res
        .status(500)
        .json({ error: 'No OAuth state or authorization URL received from CLIProxyAPI' });
      return;
    }

    res.json({
      success: true,
      authUrl: authUrl || null,
      state: data.state || null,
      method: data.method || null,
    });
  } catch (error) {
    respondInternalError(res, error, 'CLIProxyAPI not reachable.', 503);
  }
});

/**
 * GET /api/cliproxy/auth/:provider/status - Poll OAuth status
 * Checks if OAuth has completed for the given state
 */
router.get('/:provider/status', async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.params;
  const { state } = req.query;

  if (!state || typeof state !== 'string') {
    res.status(400).json({ error: 'state query parameter required' });
    return;
  }

  // Validate provider
  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  try {
    const target = getProxyTarget();

    // CLIProxyAPI management routes are under /v0/management prefix
    const response = await fetch(
      buildProxyUrl(target, `/v0/management/get-auth-status?state=${encodeURIComponent(state)}`),
      { headers: buildManagementHeaders(target) }
    );
    const data = (await response.json()) as { status?: string; error?: string };

    res.json(data);
  } catch {
    res.status(503).json({ status: 'error', error: 'CLIProxyAPI not reachable' });
  }
});

/**
 * Parse OAuth callback URL to extract code and state parameters.
 * @param url - The callback URL to parse
 * @returns Parsed components (code, state) or empty object on failure
 */
function parseCallbackUrl(url: string): { code?: string; state?: string } {
  try {
    const parsed = new URL(url);
    return {
      code: parsed.searchParams.get('code') || undefined,
      state: parsed.searchParams.get('state') || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * POST /api/cliproxy/auth/:provider/submit-callback - Submit OAuth callback URL manually
 * For cross-browser OAuth flows where callback cannot redirect directly
 */
router.post('/:provider/submit-callback', async (req: Request, res: Response): Promise<void> => {
  const { provider } = req.params;
  const { redirectUrl } = req.body;

  // Check remote mode
  const target = getProxyTarget();
  if (target.isRemote) {
    res.status(501).json({ error: 'Manual callback not available in remote mode' });
    return;
  }

  // Validate provider
  if (!validProviders.includes(provider as CLIProxyProvider)) {
    res.status(400).json({ error: `Invalid provider: ${provider}` });
    return;
  }

  // Validate redirectUrl
  if (!redirectUrl || typeof redirectUrl !== 'string') {
    res.status(400).json({ error: 'redirectUrl is required' });
    return;
  }

  const parsed = parseCallbackUrl(redirectUrl);
  if (!parsed.code) {
    res.status(400).json({ error: 'Invalid callback URL: missing code parameter' });
    return;
  }

  try {
    const callbackProvider =
      CLIPROXY_CALLBACK_PROVIDER_MAP[provider as CLIProxyProvider] || provider;

    // Forward to CLIProxyAPI /oauth-callback endpoint (under /v0/management prefix)
    const response = await fetch(buildProxyUrl(target, '/v0/management/oauth-callback'), {
      method: 'POST',
      headers: buildManagementHeaders(target, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        provider: callbackProvider,
        redirect_url: redirectUrl,
      }),
    });

    const data = (await response.json()) as { status?: string; error?: string };

    if (!response.ok || data.status === 'error') {
      res.status(response.status >= 400 ? response.status : 400).json({
        error: data.error || 'OAuth callback failed',
      });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    respondInternalError(res, error, 'CLIProxyAPI not reachable.', 503);
  }
});

export default router;
