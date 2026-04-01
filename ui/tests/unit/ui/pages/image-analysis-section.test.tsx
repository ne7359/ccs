import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, userEvent, waitFor } from '@tests/setup/test-utils';
import ImageAnalysisSection from '@/pages/settings/sections/image-analysis';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ImageAnalysisSection', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    let payload = {
      config: {
        enabled: true,
        timeout: 60,
        providerModels: {
          gemini: 'gemini-3-flash-preview',
          ghcp: 'claude-haiku-4.5',
        },
        fallbackBackend: 'gemini',
        profileBackends: {
          codexProfile: 'ghcp',
        },
      },
      summary: {
        state: 'partial',
        title: 'Partially ready',
        detail:
          '1 profile routes through Image on the current Claude target path. 1 prefer native image reading.',
        backendCount: 2,
        mappedProfileCount: 1,
        activeProfileCount: 1,
        bypassedProfileCount: 1,
        nativeProfileCount: 1,
      },
      backends: [
        {
          backendId: 'gemini',
          displayName: 'Google Gemini',
          model: 'gemini-3-flash-preview',
          state: 'ready',
          authReadiness: 'ready',
          authReason: null,
          proxyReadiness: 'ready',
          proxyReason: null,
          profilesUsing: 1,
        },
        {
          backendId: 'ghcp',
          displayName: 'GitHub Copilot (OAuth)',
          model: 'claude-haiku-4.5',
          state: 'needs_auth',
          authReadiness: 'missing',
          authReason: 'Run ccs ghcp --auth',
          proxyReadiness: 'ready',
          proxyReason: null,
          profilesUsing: 1,
        },
      ],
      profiles: [
        {
          name: 'glm',
          kind: 'profile',
          target: 'claude',
          configured: true,
          settingsPath: '/tmp/glm.settings.json',
          backendId: 'gemini',
          backendDisplayName: 'Google Gemini',
          resolutionSource: 'cliproxy-bridge',
          status: 'active',
          effectiveRuntimeMode: 'cliproxy-image-analysis',
          effectiveRuntimeReason: null,
          currentTargetMode: 'active',
          profileModel: 'gemini-3-flash-preview',
          nativeReadPreference: false,
          nativeImageCapable: true,
          nativeImageReason: 'gemini-3-flash-preview can read images natively.',
        },
        {
          name: 'codexProfile',
          kind: 'profile',
          target: 'codex',
          configured: true,
          settingsPath: '/tmp/codex.settings.json',
          backendId: 'ghcp',
          backendDisplayName: 'GitHub Copilot (OAuth)',
          resolutionSource: 'profile-backend',
          status: 'mapped',
          effectiveRuntimeMode: 'cliproxy-image-analysis',
          effectiveRuntimeReason: null,
          currentTargetMode: 'bypassed',
          profileModel: 'claude-haiku-4.5',
          nativeReadPreference: true,
          nativeImageCapable: true,
          nativeImageReason: 'claude-haiku-4.5 can read images natively.',
        },
      ],
      catalog: {
        knownBackends: ['gemini', 'ghcp', 'codex'],
        profileNames: ['glm', 'codexProfile'],
      },
    };

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/image-analysis' && method === 'GET') {
        return jsonResponse(payload);
      }

      if (url === '/api/config/raw' && method === 'GET') {
        return new Response('image_analysis:\n  enabled: true\n');
      }

      if (url === '/api/image-analysis' && method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          enabled?: boolean;
          timeout?: number;
          fallbackBackend?: string;
          profileBackends?: Record<string, string>;
          providerModels?: Record<string, string | null>;
        };
        const providerModels = body.providerModels ?? {};

        payload = {
          ...payload,
          config: {
            enabled: body.enabled ?? payload.config.enabled,
            timeout: body.timeout ?? payload.config.timeout,
            fallbackBackend:
              'fallbackBackend' in body
                ? (body.fallbackBackend ?? null)
                : payload.config.fallbackBackend,
            providerModels: {
              gemini:
                'gemini' in providerModels
                  ? (providerModels.gemini ?? '')
                  : payload.config.providerModels.gemini,
              ghcp:
                'ghcp' in providerModels
                  ? (providerModels.ghcp ?? '')
                  : payload.config.providerModels.ghcp,
            },
            profileBackends: body.profileBackends ?? payload.config.profileBackends,
          },
        };

        return jsonResponse(payload);
      }

      return jsonResponse({ error: `Unhandled request: ${method} ${url}` }, 500);
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders global controls and saves updated config', async () => {
    render(<ImageAnalysisSection />, { withSettingsProvider: true });

    expect(await screen.findByText('Image')).toBeInTheDocument();
    expect(screen.getByText('Partially ready')).toBeInTheDocument();
    expect(screen.getByText('Core setup')).toBeInTheDocument();
    expect(screen.getAllByText('Native reading').length).toBeGreaterThan(0);
    expect(screen.getByText('Profile routing')).toBeInTheDocument();
    expect(screen.getAllByText('Coverage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bypassed').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();

    const timeoutInput = screen.getByDisplayValue('60');
    await userEvent.clear(timeoutInput);
    await userEvent.type(timeoutInput, '120');
    await userEvent.tab();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/image-analysis',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    const putCall = fetchMock.mock.calls
      .filter(
        ([url, init]) =>
          url === '/api/image-analysis' && (init as RequestInit | undefined)?.method === 'PUT'
      )
      .at(-1);
    expect(putCall).toBeDefined();

    const requestBody = JSON.parse(String((putCall?.[1] as RequestInit | undefined)?.body ?? '{}'));
    expect(requestBody).toMatchObject({
      timeout: 120,
      fallbackBackend: 'gemini',
      profileBackends: {
        codexProfile: 'ghcp',
      },
    });

    expect(await screen.findByText('Image settings saved.')).toBeInTheDocument();
  });

  it('allows saving a disabled configuration even when every provider model is cleared', async () => {
    render(<ImageAnalysisSection />, { withSettingsProvider: true });

    await screen.findByDisplayValue('gemini-3-flash-preview');

    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/image-analysis',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue('gemini-3-flash-preview')).not.toBeDisabled();
    });

    fetchMock.mockClear();

    await userEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/image-analysis',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Clear' })).toHaveLength(1);
    });

    fetchMock.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/image-analysis',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    const putCall = fetchMock.mock.calls
      .filter(
        ([url, init]) =>
          url === '/api/image-analysis' && (init as RequestInit | undefined)?.method === 'PUT'
      )
      .at(-1);
    expect(putCall).toBeDefined();

    const requestBody = JSON.parse(String((putCall?.[1] as RequestInit | undefined)?.body ?? '{}'));
    expect(requestBody).toMatchObject({
      enabled: false,
      fallbackBackend: null,
      providerModels: {
        gemini: null,
        ghcp: null,
      },
    });
  });

  it('auto-saves edits without rendering a dedicated save button', async () => {
    render(<ImageAnalysisSection />, { withSettingsProvider: true });

    expect(await screen.findByText('Image')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();

    const timeoutInput = screen.getByDisplayValue('60');
    await userEvent.clear(timeoutInput);
    await userEvent.type(timeoutInput, '90');
    await userEvent.tab();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/image-analysis',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('surfaces a clear retryable error when the backend route is not available yet', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/image-analysis' && method === 'GET') {
        return new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        });
      }

      if (url === '/api/config/raw' && method === 'GET') {
        return new Response('image_analysis:\n  enabled: true\n');
      }

      return jsonResponse({ error: `Unhandled request: ${method} ${url}` }, 500);
    });

    render(<ImageAnalysisSection />, { withSettingsProvider: true });

    expect(
      await screen.findByText(
        /Image settings returned an unexpected response\. Restart the dashboard server/i
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
