import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InstanceManager } from '../../src/management/instance-manager';
import SharedManager from '../../src/management/shared-manager';

describe('InstanceManager MCP sync', () => {
  let tempRoot = '';
  let originalHome: string | undefined;
  let originalCcsHome: string | undefined;
  let originalCcsDir: string | undefined;

  const claudeDir = () => path.join(tempRoot, '.claude');
  const marketplacePath = (configDir: string, name = 'claude-code-plugins') =>
    path.join(configDir, 'plugins', 'marketplaces', name);
  const readJson = (filePath: string) =>
    JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;

  function writeMarketplaceRegistry(registryPath: string, installLocation: string): void {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(
      registryPath,
      JSON.stringify(
        {
          'claude-code-plugins': {
            installLocation,
          },
        },
        null,
        2
      ),
      'utf8'
    );
  }

  function writeMarketplaceRegistryWithMetadata(
    registryPath: string,
    installLocation: string,
    metadata: Record<string, unknown>
  ): void {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(
      registryPath,
      JSON.stringify(
        {
          'claude-code-plugins': {
            installLocation,
            ...metadata,
          },
        },
        null,
        2
      ),
      'utf8'
    );
  }

  function expectMarketplaceLocation(registryPath: string, expectedLocation: string): void {
    const parsed = readJson(registryPath) as Record<string, { installLocation?: string }>;
    expect(parsed['claude-code-plugins']?.installLocation).toBe(expectedLocation);
  }

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-instance-mcp-test-'));
    originalHome = process.env.HOME;
    originalCcsHome = process.env.CCS_HOME;
    originalCcsDir = process.env.CCS_DIR;

    spyOn(os, 'homedir').mockReturnValue(tempRoot);
    process.env.HOME = tempRoot;
    process.env.CCS_HOME = tempRoot;
    delete process.env.CCS_DIR;
  });

  afterEach(() => {
    mock.restore();

    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;

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

    const instanceContent = readJson(path.join(instancePath, '.claude.json')) as {
      otherKey: string;
      mcpServers: Record<string, { command: string }>;
    };
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
    const linkSharedSpy = spyOn(
      SharedManager.prototype,
      'linkSharedDirectories'
    ).mockImplementation(() => {});
    spyOn(SharedManager.prototype, 'syncProjectContext').mockResolvedValue(undefined);
    spyOn(SharedManager.prototype, 'syncAdvancedContinuityArtifacts').mockResolvedValue(undefined);
    const syncMcpSpy = spyOn(InstanceManager.prototype, 'syncMcpServers').mockImplementation(
      () => false
    );

    const manager = new InstanceManager();
    const instancePath = manager.getInstancePath('sandbox');
    const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
    writeMarketplaceRegistry(
      globalRegistryPath,
      path.join(
        tempRoot,
        '.ccs',
        'instances',
        'work',
        'plugins',
        'marketplaces',
        'claude-code-plugins'
      )
    );

    await manager.ensureInstance('sandbox', { mode: 'isolated' }, { bare: true });

    expect(linkSharedSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(instancePath)).toBe(true);
    expectMarketplaceLocation(globalRegistryPath, marketplacePath(claudeDir()));
    expect(fs.existsSync(path.join(instancePath, 'plugins', 'known_marketplaces.json'))).toBe(
      false
    );
    expect(syncMcpSpy).not.toHaveBeenCalled();
  });

  it('rewrites existing non-bare instance marketplace metadata to the instance-local plugin dir', async () => {
    spyOn(SharedManager.prototype, 'syncProjectContext').mockResolvedValue(undefined);
    spyOn(SharedManager.prototype, 'syncAdvancedContinuityArtifacts').mockResolvedValue(undefined);
    const syncMcpSpy = spyOn(InstanceManager.prototype, 'syncMcpServers').mockImplementation(
      () => false
    );

    const manager = new InstanceManager();
    const instancePath = manager.getInstancePath('work');
    writeMarketplaceRegistry(
      path.join(instancePath, 'plugins', 'known_marketplaces.json'),
      path.join(tempRoot, '.claude', 'plugins', 'marketplaces', 'claude-code-plugins')
    );

    await manager.ensureInstance('work', { mode: 'isolated' });

    expectMarketplaceLocation(
      path.join(instancePath, 'plugins', 'known_marketplaces.json'),
      marketplacePath(instancePath)
    );
    expect(syncMcpSpy).toHaveBeenCalledWith(instancePath);
  });

  it('writes new non-bare instance marketplace metadata without clobbering the global copy', async () => {
    spyOn(SharedManager.prototype, 'syncProjectContext').mockResolvedValue(undefined);
    spyOn(SharedManager.prototype, 'syncAdvancedContinuityArtifacts').mockResolvedValue(undefined);
    const syncMcpSpy = spyOn(InstanceManager.prototype, 'syncMcpServers').mockImplementation(
      () => false
    );

    const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
    writeMarketplaceRegistry(
      globalRegistryPath,
      path.join(
        tempRoot,
        '.ccs',
        'instances',
        'work',
        'plugins',
        'marketplaces',
        'claude-code-plugins'
      )
    );

    const manager = new InstanceManager();
    const instancePath = await manager.ensureInstance('work', { mode: 'isolated' });

    expectMarketplaceLocation(globalRegistryPath, marketplacePath(claudeDir()));
    expectMarketplaceLocation(
      path.join(instancePath, 'plugins', 'known_marketplaces.json'),
      marketplacePath(instancePath)
    );
    expect(syncMcpSpy).toHaveBeenCalledWith(instancePath);
  });

  it('reconciles marketplace metadata across isolated instances without losing refresh fields', async () => {
    spyOn(SharedManager.prototype, 'syncProjectContext').mockResolvedValue(undefined);
    spyOn(SharedManager.prototype, 'syncAdvancedContinuityArtifacts').mockResolvedValue(undefined);

    const manager = new InstanceManager();
    const workPath = await manager.ensureInstance('work', { mode: 'isolated' });
    const workRegistryPath = path.join(workPath, 'plugins', 'known_marketplaces.json');
    writeMarketplaceRegistryWithMetadata(workRegistryPath, marketplacePath(workPath), {
      label: 'Official marketplace',
      refreshToken: 'refresh-token',
      metadata: {
        source: 'refresh-flow',
        lastSyncedAt: '2026-03-18T00:00:00Z',
      },
    });

    const personalPath = await manager.ensureInstance('personal', { mode: 'isolated' });
    const workRegistry = readJson(workRegistryPath) as Record<
      string,
      {
        installLocation?: string;
        label?: string;
        refreshToken?: string;
        metadata?: Record<string, unknown>;
      }
    >;
    const personalRegistry = readJson(path.join(personalPath, 'plugins', 'known_marketplaces.json')) as Record<
      string,
      {
        installLocation?: string;
        label?: string;
        refreshToken?: string;
        metadata?: Record<string, unknown>;
      }
    >;

    expect(workRegistry['claude-code-plugins']).toMatchObject({
      installLocation: marketplacePath(workPath),
      label: 'Official marketplace',
      refreshToken: 'refresh-token',
      metadata: {
        source: 'refresh-flow',
        lastSyncedAt: '2026-03-18T00:00:00Z',
      },
    });
    expect(personalRegistry['claude-code-plugins']).toMatchObject({
      installLocation: marketplacePath(personalPath),
      label: 'Official marketplace',
      refreshToken: 'refresh-token',
      metadata: {
        source: 'refresh-flow',
        lastSyncedAt: '2026-03-18T00:00:00Z',
      },
    });
  });

  it('upgrades a legacy shared plugins symlink to an instance-local layout', async () => {
    spyOn(SharedManager.prototype, 'syncProjectContext').mockResolvedValue(undefined);
    spyOn(SharedManager.prototype, 'syncAdvancedContinuityArtifacts').mockResolvedValue(undefined);

    const manager = new InstanceManager();
    const legacyPath = manager.getInstancePath('legacy');
    const sharedPluginsPath = path.join(tempRoot, '.ccs', 'shared', 'plugins');
    fs.mkdirSync(sharedPluginsPath, { recursive: true });
    fs.mkdirSync(legacyPath, { recursive: true });
    fs.symlinkSync(sharedPluginsPath, path.join(legacyPath, 'plugins'), 'dir');

    writeMarketplaceRegistryWithMetadata(
      path.join(claudeDir(), 'plugins', 'known_marketplaces.json'),
      path.join(tempRoot, '.ccs', 'shared', 'plugins', 'marketplaces', 'claude-code-plugins'),
      {
        label: 'Legacy marketplace',
        refreshToken: 'legacy-refresh-token',
      }
    );

    await manager.ensureInstance('legacy', { mode: 'isolated' });

    expect(fs.lstatSync(path.join(legacyPath, 'plugins')).isSymbolicLink()).toBe(false);
    expectMarketplaceLocation(
      path.join(legacyPath, 'plugins', 'known_marketplaces.json'),
      marketplacePath(legacyPath)
    );

    const legacyRegistry = readJson(
      path.join(legacyPath, 'plugins', 'known_marketplaces.json')
    ) as Record<
      string,
      { installLocation?: string; label?: string; refreshToken?: string }
    >;
    expect(legacyRegistry['claude-code-plugins']).toMatchObject({
      installLocation: marketplacePath(legacyPath),
      label: 'Legacy marketplace',
      refreshToken: 'legacy-refresh-token',
    });
  });
});
