import { describe, expect, it } from 'bun:test';
import type { AccountInfo } from '../../../src/cliproxy/accounts';
import { createSourceResolver } from '../../../src/cliproxy/source-resolver';
import type { CLIProxyProvider } from '../../../src/cliproxy/types';

function createAccountsMap(): Record<CLIProxyProvider, AccountInfo[]> {
  return {
    gemini: [],
    codex: [],
    agy: [],
    qwen: [],
    iflow: [],
    kiro: [],
    ghcp: [],
    claude: [],
  };
}

function makeAccount(
  provider: CLIProxyProvider,
  id: string,
  options: { email?: string; nickname?: string } = {}
): AccountInfo {
  return {
    id,
    provider,
    isDefault: true,
    tokenFile: `${provider}-${id}.json`,
    createdAt: '2026-01-01T00:00:00.000Z',
    email: options.email,
    nickname: options.nickname,
  };
}

describe('source resolver', () => {
  it('matches by account ID before other strategies', () => {
    const accounts = createAccountsMap();
    accounts.codex = [makeAccount('codex', 'primary-id', { email: 'user@example.com' })];

    const resolver = createSourceResolver(accounts, 'v2');
    const result = resolver.resolve('primary-id', 'codex');

    expect(result.matched).toBe(true);
    expect(result.matchStep).toBe('account_id');
    expect(result.accountId).toBe('primary-id');
    expect(result.accountKey).toBe('codex:primary-id');
  });

  it('matches by email, then nickname in v2 mode', () => {
    const accounts = createAccountsMap();
    accounts.gemini = [
      makeAccount('gemini', 'gem-1', { email: 'owner@example.com', nickname: 'team-main' }),
    ];

    const resolver = createSourceResolver(accounts, 'v2');

    const emailResult = resolver.resolve('owner@example.com', 'gemini');
    expect(emailResult.matched).toBe(true);
    expect(emailResult.matchStep).toBe('email');

    const nicknameResult = resolver.resolve('team-main', 'gemini');
    expect(nicknameResult.matched).toBe(true);
    expect(nicknameResult.matchStep).toBe('nickname');
  });

  it('uses provider-qualified account keys to avoid cross-provider collisions', () => {
    const accounts = createAccountsMap();
    accounts.codex = [makeAccount('codex', 'shared-id', { email: 'shared@example.com' })];
    accounts.gemini = [makeAccount('gemini', 'shared-id', { email: 'shared@example.com' })];

    const resolver = createSourceResolver(accounts, 'v2');
    const codexResult = resolver.resolve('shared-id', 'codex');
    const geminiResult = resolver.resolve('shared-id', 'gemini');

    expect(codexResult.accountKey).toBe('codex:shared-id');
    expect(geminiResult.accountKey).toBe('gemini:shared-id');
  });

  it('matches normalized aliases in v2 mode', () => {
    const accounts = createAccountsMap();
    accounts.codex = [
      makeAccount('codex', 'codex-1', { email: 'dev@example.com', nickname: 'dev-main' }),
    ];

    const resolver = createSourceResolver(accounts, 'v2');
    const result = resolver.resolve('codex:dev_main', 'codex');

    expect(result.matched).toBe(true);
    expect(result.matchStep).toBe('alias');
    expect(result.accountId).toBe('codex-1');
  });

  it('maps provider aliases from external names when resolving', () => {
    const accounts = createAccountsMap();
    accounts.ghcp = [
      makeAccount('ghcp', 'ghcp-user', { email: 'copilot@example.com', nickname: 'copilot-main' }),
    ];

    const resolver = createSourceResolver(accounts, 'v2');
    const result = resolver.resolve('copilot-main', 'copilot');

    expect(result.matched).toBe(true);
    expect(result.provider).toBe('ghcp');
    expect(result.matchStep).toBe('nickname');
  });

  it('keeps v1 behavior strict to account ID and email', () => {
    const accounts = createAccountsMap();
    accounts.qwen = [makeAccount('qwen', 'q-1', { email: 'q@example.com', nickname: 'q-main' })];

    const resolver = createSourceResolver(accounts, 'v1');
    const nicknameResult = resolver.resolve('q-main', 'qwen');
    const emailResult = resolver.resolve('q@example.com', 'qwen');

    expect(nicknameResult.matched).toBe(false);
    expect(nicknameResult.matchStep).toBe('unmapped');
    expect(emailResult.matched).toBe(true);
    expect(emailResult.matchStep).toBe('email');
  });

  it('applies deterministic tie-break when aliases collide', () => {
    const accounts = createAccountsMap();
    accounts.codex = [
      makeAccount('codex', 'beta@example.com', { nickname: 'team-alpha' }),
      makeAccount('codex', 'alpha@example.com', { nickname: 'team_alpha' }),
    ];

    const resolver = createSourceResolver(accounts, 'v2');
    const result = resolver.resolve('teamalpha', 'codex');

    expect(result.matched).toBe(true);
    expect(result.ambiguous).toBe(true);
    expect(result.accountId).toBe('alpha@example.com');
    expect(result.candidateAccountIds).toEqual([
      'codex:alpha@example.com',
      'codex:beta@example.com',
    ]);
  });

  it('returns unmapped for cross-provider alias collisions without provider hint', () => {
    const accounts = createAccountsMap();
    accounts.codex = [makeAccount('codex', 'codex-1', { nickname: 'shared-team' })];
    accounts.gemini = [makeAccount('gemini', 'gemini-1', { nickname: 'shared-team' })];

    const resolver = createSourceResolver(accounts, 'v2');
    const result = resolver.resolve('shared-team');

    expect(result.matched).toBe(false);
    expect(result.matchStep).toBe('unmapped');
  });

  it('does not map empty or whitespace sources', () => {
    const accounts = createAccountsMap();
    accounts.codex = [makeAccount('codex', 'codex-1', { email: 'dev@example.com' })];

    const resolver = createSourceResolver(accounts, 'v2');
    const emptyResult = resolver.resolve('');
    const whitespaceResult = resolver.resolve('   ');

    expect(emptyResult.matched).toBe(false);
    expect(emptyResult.matchStep).toBe('unmapped');
    expect(whitespaceResult.matched).toBe(false);
    expect(whitespaceResult.matchStep).toBe('unmapped');
  });

  it('treats unknown provider hints as unmapped scope', () => {
    const accounts = createAccountsMap();
    accounts.codex = [makeAccount('codex', 'codex-1', { nickname: 'team-main' })];

    const resolver = createSourceResolver(accounts, 'v2');
    const result = resolver.resolve('team-main', 'unknown-provider');

    expect(result.matched).toBe(false);
    expect(result.matchStep).toBe('unmapped');
  });

  it('returns unmapped when no strategy matches', () => {
    const accounts = createAccountsMap();
    const resolver = createSourceResolver(accounts, 'v2');
    const result = resolver.resolve('unknown-source', 'gemini');

    expect(result.matched).toBe(false);
    expect(result.matchStep).toBe('unmapped');
    expect(result.accountId).toBeNull();
    expect(result.accountKey).toBeNull();
  });
});
