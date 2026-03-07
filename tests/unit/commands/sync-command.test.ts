import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { handleSyncCommand } from '../../../src/commands/sync-command';
import { ClaudeDirInstaller } from '../../../src/utils/claude-dir-installer';
import { ClaudeSymlinkManager } from '../../../src/utils/claude-symlink-manager';
import SharedManager from '../../../src/management/shared-manager';
import { InstanceManager } from '../../../src/management/instance-manager';
import ProfileRegistry from '../../../src/auth/profile-registry';
import type { ProfileMetadata } from '../../../src/types';

function profile(metadata: Partial<ProfileMetadata> = {}): ProfileMetadata {
  return {
    type: 'account',
    created: '2026-03-05T00:00:00.000Z',
    last_used: null,
    ...metadata,
  };
}

describe('sync command MCP sync behavior', () => {
  let originalProcessExit: typeof process.exit;

  beforeEach(() => {
    originalProcessExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalProcessExit;
    mock.restore();
  });

  it('syncs MCP servers only to non-bare profiles', async () => {
    spyOn(ClaudeDirInstaller.prototype, 'install').mockReturnValue(true);
    spyOn(ClaudeDirInstaller.prototype, 'cleanupDeprecated').mockReturnValue({
      success: true,
      cleanedFiles: [],
    });
    spyOn(ClaudeSymlinkManager.prototype, 'install').mockImplementation(() => {});
    spyOn(SharedManager.prototype, 'ensureSharedDirectories').mockImplementation(() => {});
    spyOn(ProfileRegistry.prototype, 'getAllProfilesMerged').mockReturnValue({
      work: profile(),
      sandbox: profile({ bare: true }),
      personal: profile(),
    });
    spyOn(InstanceManager.prototype, 'hasInstance').mockReturnValue(true);

    const getInstancePathSpy = spyOn(InstanceManager.prototype, 'getInstancePath').mockImplementation(
      (name: string) => `/tmp/${name}`
    );
    const syncMcpSpy = spyOn(InstanceManager.prototype, 'syncMcpServers').mockImplementation(
      () => true
    );

    await expect(handleSyncCommand()).rejects.toThrow('process.exit(0)');

    expect(getInstancePathSpy.mock.calls.map((call) => call[0])).toEqual(['work', 'personal']);
    expect(syncMcpSpy.mock.calls.map((call) => call[0])).toEqual(['/tmp/work', '/tmp/personal']);
  });

  it('skips MCP sync when all profiles are bare', async () => {
    spyOn(ClaudeDirInstaller.prototype, 'install').mockReturnValue(true);
    spyOn(ClaudeDirInstaller.prototype, 'cleanupDeprecated').mockReturnValue({
      success: true,
      cleanedFiles: [],
    });
    spyOn(ClaudeSymlinkManager.prototype, 'install').mockImplementation(() => {});
    spyOn(SharedManager.prototype, 'ensureSharedDirectories').mockImplementation(() => {});
    spyOn(ProfileRegistry.prototype, 'getAllProfilesMerged').mockReturnValue({
      sandbox: profile({ bare: true }),
      experiment: profile({ bare: true }),
    });
    spyOn(InstanceManager.prototype, 'hasInstance').mockReturnValue(true);

    const syncMcpSpy = spyOn(InstanceManager.prototype, 'syncMcpServers').mockImplementation(
      () => true
    );

    await expect(handleSyncCommand()).rejects.toThrow('process.exit(0)');

    expect(syncMcpSpy).not.toHaveBeenCalled();
  });
});
