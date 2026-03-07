import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InstanceManager } from '../../src/management/instance-manager';
import SharedManager from '../../src/management/shared-manager';

describe('InstanceManager MCP sync', () => {
  let tempRoot = '';
  let originalCcsHome: string | undefined;
  let originalCcsDir: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-instance-mcp-test-'));
    originalCcsHome = process.env.CCS_HOME;
    originalCcsDir = process.env.CCS_DIR;

    process.env.CCS_HOME = tempRoot;
    delete process.env.CCS_DIR;
  });

  afterEach(() => {
    mock.restore();

    if (originalCcsHome !== undefined) process.env.CCS_HOME = originalCcsHome;
    else delete process.env.CCS_HOME;

    if (originalCcsDir !== undefined) process.env.CCS_DIR = originalCcsDir;
    else delete process.env.CCS_DIR;

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('merges global MCP servers and preserves instance-specific overrides', () => {
    fs.writeFileSync(
      path.join(tempRoot, '.claude.json'),
      JSON.stringify(
        {
          mcpServers: {
            globalOnly: { command: 'global-cmd' },
            shared: { command: 'global-shared' },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const manager = new InstanceManager();
    const instancePath = manager.getInstancePath('work');
    fs.mkdirSync(instancePath, { recursive: true });
    fs.writeFileSync(
      path.join(instancePath, '.claude.json'),
      JSON.stringify(
        {
          mcpServers: {
            shared: { command: 'instance-shared' },
            instanceOnly: { command: 'instance-only' },
          },
          otherKey: 'keep-me',
        },
        null,
        2
      ),
      'utf8'
    );

    const synced = manager.syncMcpServers(instancePath);
    expect(synced).toBe(true);

    const instanceContent = JSON.parse(fs.readFileSync(path.join(instancePath, '.claude.json'), 'utf8'));
    expect(instanceContent.otherKey).toBe('keep-me');
    expect(instanceContent.mcpServers).toEqual({
      globalOnly: { command: 'global-cmd' },
      shared: { command: 'instance-shared' },
      instanceOnly: { command: 'instance-only' },
    });
  });

  it('logs warning when global MCP sync fails', () => {
    fs.writeFileSync(path.join(tempRoot, '.claude.json'), '{invalid-json', 'utf8');
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new InstanceManager();
    const instancePath = manager.getInstancePath('work');
    fs.mkdirSync(instancePath, { recursive: true });

    const synced = manager.syncMcpServers(instancePath);

    expect(synced).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0] || '')).toContain('MCP sync skipped');
  });

  it('skips shared symlinks and MCP sync for bare instance creation', async () => {
    const linkSharedSpy = spyOn(SharedManager.prototype, 'linkSharedDirectories').mockImplementation(
      () => {}
    );
    spyOn(SharedManager.prototype, 'syncProjectContext').mockResolvedValue(undefined);
    spyOn(SharedManager.prototype, 'syncAdvancedContinuityArtifacts').mockResolvedValue(undefined);
    const syncMcpSpy = spyOn(InstanceManager.prototype, 'syncMcpServers').mockImplementation(
      () => false
    );

    const manager = new InstanceManager();
    await manager.ensureInstance('sandbox', { mode: 'isolated' }, { bare: true });

    expect(linkSharedSpy).not.toHaveBeenCalled();
    expect(syncMcpSpy).not.toHaveBeenCalled();
  });
});
