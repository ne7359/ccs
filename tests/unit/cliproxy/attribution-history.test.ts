import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AttributionHistoryStore } from '../../../src/cliproxy/attribution-history';
import type { SourceResolution } from '../../../src/cliproxy/source-resolver';

function makeResolution(
  source: string,
  overrides: Partial<SourceResolution> = {}
): SourceResolution {
  return {
    source,
    normalizedSource: source.trim().toLowerCase(),
    matched: true,
    provider: 'codex',
    accountId: 'acct-1',
    accountKey: 'codex:acct-1',
    matchStep: 'alias',
    resolverVersion: 'v2',
    ambiguous: false,
    ...overrides,
  };
}

describe('attribution-history', () => {
  let originalCcsHome: string | undefined;
  let tempHome = '';

  beforeEach(() => {
    originalCcsHome = process.env.CCS_HOME;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-attribution-history-'));
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
    }
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('persists and reloads stored source mappings', async () => {
    const store = await AttributionHistoryStore.load();
    store.remember('Team-Alpha', 'codex', makeResolution('Team-Alpha'));
    await store.persist();

    const reloaded = await AttributionHistoryStore.load();
    const resolved = reloaded.resolve('team-alpha', 'codex');

    expect(resolved).not.toBeNull();
    expect(resolved?.matched).toBe(true);
    expect(resolved?.accountKey).toBe('codex:acct-1');
    expect(resolved?.resolverVersion).toBe('v2');
  });

  it('keeps historical resolver versions for existing sources after rollback', async () => {
    const store = await AttributionHistoryStore.load();
    store.remember(
      'legacy-source',
      'codex',
      makeResolution('legacy-source', {
        resolverVersion: 'v2',
        matchStep: 'nickname',
      })
    );
    await store.persist();

    const afterRollback = await AttributionHistoryStore.load();
    const historical = afterRollback.resolve('legacy-source', 'codex');
    expect(historical?.resolverVersion).toBe('v2');
    expect(historical?.matchStep).toBe('nickname');

    afterRollback.remember(
      'new-source',
      'codex',
      makeResolution('new-source', {
        matched: false,
        provider: null,
        accountId: null,
        accountKey: null,
        matchStep: 'unmapped',
        resolverVersion: 'v1',
      })
    );
    await afterRollback.persist();

    const finalStore = await AttributionHistoryStore.load();
    expect(finalStore.resolve('legacy-source', 'codex')?.resolverVersion).toBe('v2');
    expect(finalStore.resolve('new-source', 'codex')?.resolverVersion).toBe('v1');
  });

  it('normalizes provider aliases for stable history keys', async () => {
    const store = await AttributionHistoryStore.load();
    store.remember(
      'copilot-main',
      'copilot',
      makeResolution('copilot-main', {
        provider: 'ghcp',
        accountId: 'ghcp-1',
        accountKey: 'ghcp:ghcp-1',
      })
    );
    await store.persist();

    const reloaded = await AttributionHistoryStore.load();
    const resolved = reloaded.resolve('copilot-main', 'ghcp');
    expect(resolved?.provider).toBe('ghcp');
    expect(resolved?.accountKey).toBe('ghcp:ghcp-1');
  });

  it('does not fallback to wildcard mapping when provider hint is present', async () => {
    const store = await AttributionHistoryStore.load();
    store.remember(
      'shared-source',
      undefined,
      makeResolution('shared-source', {
        provider: 'codex',
        accountId: 'codex-1',
        accountKey: 'codex:codex-1',
      })
    );
    await store.persist();

    const reloaded = await AttributionHistoryStore.load();
    expect(reloaded.resolve('shared-source', 'gemini')).toBeNull();
    expect(reloaded.resolve('shared-source')).not.toBeNull();
  });
});
