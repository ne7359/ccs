import { fireEvent, render, screen, waitFor } from '@tests/setup/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageAnalysisStatus } from '@/lib/api-client';

vi.mock('@/components/shared/code-editor', () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="raw config editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('@/components/profiles/editor/header-section', () => ({
  HeaderSection: () => <div data-testid="profile-editor-header" />,
}));

vi.mock('@/components/profiles/editor/friendly-ui-section', () => ({
  FriendlyUISection: () => <div data-testid="profile-editor-friendly-ui" />,
}));

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('@/components/shared/global-env-indicator', () => ({
  GlobalEnvIndicator: () => <div data-testid="global-env-indicator" />,
}));

import { ImageAnalysisStatusSection } from '@/components/profiles/editor/image-analysis-status-section';
import { ProfileEditor } from '@/components/profiles/editor';

function createStatus(overrides: Partial<ImageAnalysisStatus> = {}): ImageAnalysisStatus {
  return {
    enabled: true,
    supported: true,
    status: 'active',
    backendId: 'gemini',
    backendDisplayName: 'Google Gemini',
    model: 'gemini-3-flash-preview',
    resolutionSource: 'cliproxy-bridge',
    reason: null,
    shouldPersistHook: true,
    persistencePath: '/tmp/.ccs/glm.settings.json',
    runtimePath: '/api/provider/gemini',
    usesCurrentTarget: true,
    usesCurrentAuthToken: true,
    hookInstalled: true,
    sharedHookInstalled: true,
    authReadiness: 'ready',
    authProvider: 'gemini',
    authDisplayName: 'Google Gemini',
    authReason: null,
    proxyReadiness: 'ready',
    proxyReason: 'Local CLIProxy service is reachable.',
    effectiveRuntimeMode: 'cliproxy-image-analysis',
    effectiveRuntimeReason: null,
    profileModel: 'gemini-3-flash-preview',
    nativeReadPreference: false,
    nativeImageCapable: true,
    nativeImageReason: 'gemini-3-flash-preview can read images natively.',
    ...overrides,
  };
}

function createJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ImageAnalysisStatusSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders a compact saved summary with a settings link', () => {
    render(<ImageAnalysisStatusSection status={createStatus()} />);

    expect(screen.getByText('Image')).toBeInTheDocument();
    expect(screen.getByText(/Saved status · Transformer ready/i)).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Use native image reading')).toBeInTheDocument();
    expect(
      screen.getByText(/Transformer route: Google Gemini · gemini-3-flash-preview\./i)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Settings/i })).toHaveAttribute(
      'href',
      '/settings?tab=image'
    );
  });

  it('shows bypassed mode when the current target is not Claude Code', () => {
    render(<ImageAnalysisStatusSection status={createStatus()} target="codex" />);

    expect(screen.getByText('Bypassed')).toBeInTheDocument();
    expect(screen.getByText(/Saved status · Codex CLI bypasses the hook/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Transformer route: Google Gemini · gemini-3-flash-preview\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Current target Codex CLI bypasses the Claude Read hook/i)
    ).toBeInTheDocument();
  });

  it('keeps auth failures visible without a long diagnostic wall', () => {
    render(
      <ImageAnalysisStatusSection
        status={createStatus({
          backendId: 'ghcp',
          backendDisplayName: 'GitHub Copilot (OAuth)',
          model: 'claude-haiku-4.5',
          profileModel: 'claude-haiku-4.5',
          authReadiness: 'missing',
          authProvider: 'ghcp',
          authDisplayName: 'GitHub Copilot (OAuth)',
          authReason:
            'GitHub Copilot (OAuth) auth is missing. Run "ccs ghcp --auth" to enable image analysis.',
          effectiveRuntimeMode: 'native-read',
          effectiveRuntimeReason:
            'GitHub Copilot (OAuth) auth is missing. Run "ccs ghcp --auth" to enable image analysis.',
        })}
      />
    );

    expect(screen.getByText('Auth')).toBeInTheDocument();
    expect(
      screen.getByText(/Transformer route: GitHub Copilot \(OAuth\) · claude-haiku-4.5\./i)
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Run "ccs ghcp --auth" to enable image analysis/i).length
    ).toBeGreaterThanOrEqual(1);
  });

  it('calls the toggle handler immediately for native image reading', () => {
    const onToggleNativeRead = vi.fn();

    render(
      <ImageAnalysisStatusSection status={createStatus()} onToggleNativeRead={onToggleNativeRead} />
    );

    fireEvent.click(screen.getByRole('switch', { name: /Use native image reading/i }));

    expect(onToggleNativeRead).toHaveBeenCalledWith(true);
  });

  it('writes the native image preference into the raw settings json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/settings/glm/raw')) {
          return Promise.resolve(
            createJsonResponse({
              profile: 'glm',
              settings: {
                env: {
                  ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
                  ANTHROPIC_AUTH_TOKEN: 'saved-token',
                },
              },
              mtime: 1,
              path: '/tmp/glm.settings.json',
              imageAnalysisStatus: createStatus(),
            })
          );
        }

        if (url.includes('/api/settings/glm/image-analysis-status')) {
          return Promise.resolve(
            createJsonResponse({
              imageAnalysisStatus: createStatus({
                backendId: null,
                backendDisplayName: null,
                model: null,
                resolutionSource: 'native-compatible',
                supported: false,
                shouldPersistHook: false,
                runtimePath: null,
                authReadiness: 'not-needed',
                authProvider: null,
                authDisplayName: null,
                authReason: null,
                proxyReadiness: 'not-needed',
                proxyReason: null,
                effectiveRuntimeMode: 'native-read',
                nativeReadPreference: true,
              }),
            })
          );
        }

        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );

    render(<ProfileEditor profileName="glm" profileTarget="claude" />);

    await screen.findByText(/Transformer route: Google Gemini/i);

    fireEvent.click(screen.getByRole('switch', { name: /Use native image reading/i }));

    await waitFor(() => {
      expect((screen.getByLabelText('raw config editor') as HTMLTextAreaElement).value).toContain(
        '"ccs_image"'
      );
    });
    expect((screen.getByLabelText('raw config editor') as HTMLTextAreaElement).value).toContain(
      '"native_read": true'
    );
  });

  it('switches to live preview when editor JSON changes', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/settings/glm/raw')) {
        return Promise.resolve(
          createJsonResponse({
            profile: 'glm',
            settings: {
              env: {
                ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
                ANTHROPIC_AUTH_TOKEN: 'saved-token',
              },
            },
            mtime: 1,
            path: '/tmp/glm.settings.json',
            imageAnalysisStatus: createStatus(),
          })
        );
      }

      if (url.includes('/api/settings/glm/image-analysis-status')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve(
          createJsonResponse({
            imageAnalysisStatus: createStatus({
              backendId: 'ghcp',
              backendDisplayName: 'GitHub Copilot (OAuth)',
              model: 'claude-haiku-4.5',
              authReadiness: 'ready',
              authProvider: 'ghcp',
              authDisplayName: 'GitHub Copilot (OAuth)',
            }),
          })
        );
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<ProfileEditor profileName="glm" profileTarget="claude" />);

    expect(await screen.findByText(/Google Gemini/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('raw config editor'), {
      target: {
        value: JSON.stringify(
          {
            env: {
              ANTHROPIC_BASE_URL: 'https://proxy.example/api/provider/ghcp',
              ANTHROPIC_AUTH_TOKEN: 'preview-token',
            },
          },
          null,
          2
        ),
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Live preview/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/GitHub Copilot \(OAuth\)/i)).toBeInTheDocument();
  });

  it('falls back to saved status messaging when the editor JSON is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/settings/glm/raw')) {
          return Promise.resolve(
            createJsonResponse({
              profile: 'glm',
              settings: {
                env: {
                  ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
                  ANTHROPIC_AUTH_TOKEN: 'saved-token',
                },
              },
              mtime: 1,
              path: '/tmp/glm.settings.json',
              imageAnalysisStatus: createStatus(),
            })
          );
        }

        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );

    render(<ProfileEditor profileName="glm" profileTarget="claude" />);

    expect(await screen.findByText(/Google Gemini/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('raw config editor'), {
      target: { value: '{' },
    });

    await waitFor(() => {
      expect(screen.getByText(/Saved status/i)).toBeInTheDocument();
    });
  });

  it('marks the preview as refreshing when a newer preview is still loading', async () => {
    let secondPreviewResolver: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/settings/glm/raw')) {
        return Promise.resolve(
          createJsonResponse({
            profile: 'glm',
            settings: {
              env: {
                ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
                ANTHROPIC_AUTH_TOKEN: 'saved-token',
              },
            },
            mtime: 1,
            path: '/tmp/glm.settings.json',
            imageAnalysisStatus: createStatus(),
          })
        );
      }

      if (url.includes('/api/settings/glm/image-analysis-status')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          settings?: { env?: Record<string, string> };
        };
        const baseUrl = body.settings?.env?.ANTHROPIC_BASE_URL ?? '';

        if (baseUrl.includes('/ghcp')) {
          return Promise.resolve(
            createJsonResponse({
              imageAnalysisStatus: createStatus({
                backendId: 'ghcp',
                backendDisplayName: 'GitHub Copilot (OAuth)',
                model: 'claude-haiku-4.5',
                authReadiness: 'ready',
                authProvider: 'ghcp',
                authDisplayName: 'GitHub Copilot (OAuth)',
              }),
            })
          );
        }

        if (baseUrl.includes('/codex')) {
          return new Promise<Response>((resolve) => {
            secondPreviewResolver = resolve;
          });
        }
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<ProfileEditor profileName="glm" profileTarget="claude" />);

    expect(await screen.findByText(/Google Gemini/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('raw config editor'), {
      target: {
        value: JSON.stringify(
          {
            env: {
              ANTHROPIC_BASE_URL: 'https://proxy.example/api/provider/ghcp',
              ANTHROPIC_AUTH_TOKEN: 'preview-token',
            },
          },
          null,
          2
        ),
      },
    });

    expect(await screen.findByText(/GitHub Copilot \(OAuth\)/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('raw config editor'), {
      target: {
        value: JSON.stringify(
          {
            env: {
              ANTHROPIC_BASE_URL: 'https://proxy.example/api/provider/codex',
              ANTHROPIC_AUTH_TOKEN: 'preview-token-2',
            },
          },
          null,
          2
        ),
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Refreshing preview/i)).toBeInTheDocument();
    });

    secondPreviewResolver?.(
      createJsonResponse({
        imageAnalysisStatus: createStatus({
          backendId: 'codex',
          backendDisplayName: 'Codex',
          model: 'gpt-5.4',
          authReadiness: 'ready',
          authProvider: 'codex',
          authDisplayName: 'Codex',
        }),
      })
    );

    await waitFor(() => {
      expect(screen.getByText(/Codex/i)).toBeInTheDocument();
    });
  });
});
