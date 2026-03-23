import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { AllProviders } from '../../setup/test-utils';
import { useCliproxyAuthFlow } from '@/hooks/use-cliproxy-auth-flow';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AllProviders>{children}</AllProviders>
);

describe('useCliproxyAuthFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ignores stale poll completions from a superseded auth attempt', async () => {
    const firstPoll = createDeferred<Response>();
    let startCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/start-url')) {
          startCount += 1;
          return Promise.resolve(
            createJsonResponse({
              success: true,
              authUrl: `https://auth.example/${startCount}`,
              state: `state-${startCount}`,
            })
          );
        }

        if (url.includes('/status?state=state-1')) {
          return firstPoll.promise;
        }

        if (url.includes('/status?state=state-2')) {
          return Promise.resolve(createJsonResponse({ status: 'wait' }));
        }

        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );

    const { result } = renderHook(() => useCliproxyAuthFlow(), { wrapper });

    await act(async () => {
      await result.current.startAuth('gemini', { startEndpoint: 'start-url' });
    });

    expect(result.current.oauthState).toBe('state-1');

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.startAuth('gemini', { startEndpoint: 'start-url' });
    });

    expect(result.current.oauthState).toBe('state-2');
    expect(result.current.isAuthenticating).toBe(true);

    await act(async () => {
      firstPoll.resolve(createJsonResponse({ status: 'ok' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.oauthState).toBe('state-2');
    expect(result.current.isAuthenticating).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('surfaces repeated poll transport failures instead of retrying forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/start-url')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              authUrl: 'https://auth.example/fail',
              state: 'state-fail',
            })
          );
        }

        if (url.includes('/status?state=state-fail')) {
          return Promise.reject(new Error('poll failed'));
        }

        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );

    const { result } = renderHook(() => useCliproxyAuthFlow(), { wrapper });

    await act(async () => {
      await result.current.startAuth('gemini', { startEndpoint: 'start-url' });
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => {
        vi.advanceTimersByTime(3000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(result.current.error).toBe('poll failed');
    expect(result.current.isAuthenticating).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('poll failed');
  });

  it('treats callback responses without an account as failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/start-url')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              authUrl: 'https://auth.example/callback',
              state: 'state-callback',
            })
          );
        }

        if (url.includes('/submit-callback')) {
          return Promise.resolve(createJsonResponse({ success: true, account: null }));
        }

        if (url.includes('/status?state=state-callback')) {
          return Promise.resolve(createJsonResponse({ status: 'wait' }));
        }

        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      })
    );

    const { result } = renderHook(() => useCliproxyAuthFlow(), { wrapper });

    await act(async () => {
      await result.current.startAuth('gemini', { startEndpoint: 'start-url' });
    });

    await act(async () => {
      await result.current.submitCallback(
        'http://localhost/callback?code=abc123&state=state-callback'
      );
    });

    expect(result.current.error).toBe('Authenticated account could not be registered');
    expect(result.current.isSubmittingCallback).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Authenticated account could not be registered');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
