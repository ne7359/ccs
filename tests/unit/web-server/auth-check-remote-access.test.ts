/**
 * Auth Check Route — Remote Access Detection Tests
 *
 * Verifies that /api/auth/check produces a distinct setup state for
 * remote clients or incomplete host config instead of always showing
 * a login form.
 */

import { describe, it, expect } from 'bun:test';
import { isLoopbackRemoteAddress } from '../../../src/web-server/middleware/auth-middleware';
import { resolveDashboardAccessState } from '../../../src/web-server/routes/auth-routes';

describe('isLoopbackRemoteAddress', () => {
  it('returns true for IPv4 localhost', () => {
    expect(isLoopbackRemoteAddress('127.0.0.1')).toBe(true);
  });

  it('returns true for IPv6 localhost', () => {
    expect(isLoopbackRemoteAddress('::1')).toBe(true);
  });

  it('returns true for IPv4-mapped IPv6 localhost', () => {
    expect(isLoopbackRemoteAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('returns true for other loopback addresses', () => {
    expect(isLoopbackRemoteAddress('127.0.0.2')).toBe(true);
    expect(isLoopbackRemoteAddress('::ffff:127.0.0.2')).toBe(true);
  });

  it('returns false for LAN addresses', () => {
    expect(isLoopbackRemoteAddress('192.168.1.100')).toBe(false);
    expect(isLoopbackRemoteAddress('10.0.0.1')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isLoopbackRemoteAddress(undefined)).toBe(false);
  });
});

describe('resolveDashboardAccessState', () => {
  it('allows localhost through when auth is disabled', () => {
    expect(
      resolveDashboardAccessState(
        { enabled: false, username: '', password_hash: '', session_timeout_hours: 24 },
        '127.0.0.1'
      )
    ).toEqual({
      authRequired: false,
      authEnabled: false,
      authConfigured: false,
      isLocalAccess: true,
      accessMode: 'open',
    });
  });

  it('shows setup state for remote access when auth is disabled', () => {
    expect(
      resolveDashboardAccessState(
        { enabled: false, username: '', password_hash: '', session_timeout_hours: 24 },
        '192.168.2.100'
      )
    ).toEqual({
      authRequired: true,
      authEnabled: false,
      authConfigured: false,
      isLocalAccess: false,
      accessMode: 'setup',
    });
  });

  it('shows login state only when auth is enabled and fully configured', () => {
    expect(
      resolveDashboardAccessState(
        {
          enabled: true,
          username: 'admin',
          password_hash: '$2b$10$123456789012345678901u4cPFsKnzGWxZmfq6OnpZnN0UiM6Qf7e',
          session_timeout_hours: 24,
        },
        '192.168.2.100'
      )
    ).toEqual({
      authRequired: true,
      authEnabled: true,
      authConfigured: true,
      isLocalAccess: false,
      accessMode: 'login',
    });
  });

  it('shows setup state when auth is enabled but credentials are incomplete', () => {
    expect(
      resolveDashboardAccessState(
        { enabled: true, username: 'admin', password_hash: '', session_timeout_hours: 24 },
        '127.0.0.1'
      )
    ).toEqual({
      authRequired: true,
      authEnabled: true,
      authConfigured: false,
      isLocalAccess: true,
      accessMode: 'setup',
    });
  });
});
