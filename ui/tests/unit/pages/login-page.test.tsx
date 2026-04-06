import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { LoginPage } from '@/pages/login';
import { render, screen, userEvent } from '@tests/setup/test-utils';

const { navigateMock, useAuthMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: useAuthMock,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');

  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ state: { from: { pathname: '/settings' } } }),
  };
});

describe('LoginPage', () => {
  beforeEach(async () => {
    navigateMock.mockReset();
    useAuthMock.mockReturnValue({
      authRequired: true,
      isAuthenticated: false,
      username: null,
      loading: false,
      accessMode: 'login',
      authEnabled: true,
      authConfigured: true,
      isLocalAccess: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    await i18n.changeLanguage('en');
  });

  it('renders a setup state for remote access when dashboard auth is unavailable', () => {
    useAuthMock.mockReturnValue({
      authRequired: true,
      isAuthenticated: false,
      username: null,
      loading: false,
      accessMode: 'setup',
      authEnabled: false,
      authConfigured: false,
      isLocalAccess: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    render(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'Remote access needs host setup' })).toBeVisible();
    expect(screen.getByText('ccs config auth setup')).toBeVisible();
    expect(screen.getByText('No default credentials ship with CCS.')).toBeVisible();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
  });

  it('toggles password visibility on the login form', async () => {
    render(<LoginPage />);

    expect(screen.getByRole('button', { name: 'Light' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Dark' })).toBeVisible();

    const passwordInput = screen.getByLabelText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});
