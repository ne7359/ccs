import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import SharedManager, {
  normalizePluginMetadataContent,
  normalizePluginMetadataPathString,
} from '../../src/management/shared-manager';

describe('SharedManager', () => {
  let tempRoot = '';
  let originalHome: string | undefined;
  let originalCcsHome: string | undefined;
  let originalCcsDir: string | undefined;
  let originalPlatform: PropertyDescriptor | undefined;

  const claudeDir = () => path.join(tempRoot, '.claude');
  const ccsDir = () => path.join(tempRoot, '.ccs');
  const instanceDir = (name: string) => path.join(ccsDir(), 'instances', name);
  const marketplacePath = (configDir: string, name = 'claude-code-plugins') =>
    path.join(configDir, 'plugins', 'marketplaces', name);
  const readJson = (filePath: string) =>
    JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;

  function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  function readMarketplaceLocation(filePath: string, name = 'claude-code-plugins'): string {
    const parsed = readJson(filePath) as Record<string, { installLocation?: string }>;
    return parsed[name]?.installLocation ?? '';
  }

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-shared-manager-test-'));
    originalHome = process.env.HOME;
    originalCcsHome = process.env.CCS_HOME;
    originalCcsDir = process.env.CCS_DIR;
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

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

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('plugin metadata path normalization', () => {
    it('rewrites instance plugin paths to the requested target config dir', () => {
      const targetConfigDir = path.join('/home/user', '.claude');
      const input = '/home/user/.ccs/instances/work/plugins/cache/plugin/0.0.2';

      expect(normalizePluginMetadataPathString(input, targetConfigDir)).toBe(
        '/home/user/.claude/plugins/cache/plugin/0.0.2'
      );
    });

    it('rewrites shared plugin paths to an instance-local target config dir', () => {
      const targetConfigDir = instanceDir('personal');
      const input = path.join(tempRoot, '.ccs', 'shared', 'plugins', 'marketplaces', 'official');

      expect(normalizePluginMetadataPathString(input, targetConfigDir)).toBe(
        marketplacePath(targetConfigDir, 'official')
      );
    });

    it('normalizes all matching JSON string values without changing the structure', () => {
      const targetConfigDir = instanceDir('work');
      const input = JSON.stringify(
        {
          plugins: {
            'plugin-a': [
              {
                installPath: path.join(
                  tempRoot,
                  '.ccs',
                  'instances',
                  'old',
                  'plugins',
                  'cache',
                  'plugin-a'
                ),
              },
            ],
          },
          marketplaces: {
            official: {
              installLocation: path.join(
                tempRoot,
                '.claude',
                'plugins',
                'marketplaces',
                'official'
              ),
            },
          },
        },
        null,
        2
      );

      const normalized = JSON.parse(normalizePluginMetadataContent(input, targetConfigDir)) as {
        plugins: { 'plugin-a': [{ installPath: string }] };
        marketplaces: { official: { installLocation: string } };
      };

      expect(normalized.plugins['plugin-a'][0].installPath).toBe(
        path.join(targetConfigDir, 'plugins', 'cache', 'plugin-a')
      );
      expect(normalized.marketplaces.official.installLocation).toBe(
        marketplacePath(targetConfigDir, 'official')
      );
    });

    it('preserves paths already rooted at the target config dir', () => {
      const targetConfigDir = instanceDir('work');
      const input = path.join(targetConfigDir, 'plugins', 'cache', 'plugin-a');

      expect(normalizePluginMetadataPathString(input, targetConfigDir)).toBe(input);
    });

    it('handles Windows path separators', () => {
      const targetConfigDir = 'C:\\Users\\user\\.claude';
      const input = 'C:\\Users\\user\\.ccs\\instances\\work\\plugins\\marketplaces\\official';

      expect(normalizePluginMetadataPathString(input, targetConfigDir)).toBe(
        'C:\\Users\\user\\.claude\\plugins\\marketplaces\\official'
      );
    });
  });

  describe('marketplace registry ownership', () => {
    it('writes global and instance registries with different authoritative install locations', () => {
      const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
      writeJson(globalRegistryPath, {
        'claude-code-plugins': {
          installLocation: path.join(
            tempRoot,
            '.ccs',
            'instances',
            'work',
            'plugins',
            'marketplaces',
            'claude-code-plugins'
          ),
        },
      });

      const instancePath = instanceDir('personal');
      fs.mkdirSync(instancePath, { recursive: true });

      const manager = new SharedManager();
      manager.linkSharedDirectories(instancePath);

      const instanceRegistryPath = path.join(instancePath, 'plugins', 'known_marketplaces.json');
      expect(readMarketplaceLocation(globalRegistryPath)).toBe(marketplacePath(claudeDir()));
      expect(readMarketplaceLocation(instanceRegistryPath)).toBe(marketplacePath(instancePath));
      expect(fs.lstatSync(path.join(instancePath, 'plugins')).isSymbolicLink()).toBe(false);
      expect(fs.lstatSync(instanceRegistryPath).isSymbolicLink()).toBe(false);
    });

    it('self-heals missing installLocation from discovered marketplace payloads', () => {
      const manager = new SharedManager();
      const instancePath = instanceDir('work');
      fs.mkdirSync(instancePath, { recursive: true });
      manager.linkSharedDirectories(instancePath);

      fs.mkdirSync(marketplacePath(claudeDir()), { recursive: true });
      writeJson(path.join(instancePath, 'plugins', 'known_marketplaces.json'), {
        'claude-code-plugins': {
          label: 'Official marketplace',
        },
      });

      manager.normalizeMarketplaceRegistryPaths(instancePath);

      const repaired = readJson(
        path.join(instancePath, 'plugins', 'known_marketplaces.json')
      ) as Record<string, { label?: string; installLocation?: string }>;
      expect(repaired['claude-code-plugins']).toEqual({
        label: 'Official marketplace',
        installLocation: marketplacePath(instancePath),
      });
    });

    it('warns and skips malformed marketplace registries while keeping valid sources', () => {
      const manager = new SharedManager();
      const instancePath = instanceDir('work');
      fs.mkdirSync(instancePath, { recursive: true });
      manager.linkSharedDirectories(instancePath);

      const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
      writeJson(globalRegistryPath, {
        'claude-code-plugins': {
          installLocation: path.join(
            tempRoot,
            '.ccs',
            'instances',
            'work',
            'plugins',
            'marketplaces',
            'claude-code-plugins'
          ),
          label: 'Official marketplace',
        },
      });

      const malformedRegistryPath = path.join(instancePath, 'plugins', 'known_marketplaces.json');
      fs.writeFileSync(malformedRegistryPath, '{invalid-json', 'utf8');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});

      manager.normalizeMarketplaceRegistryPaths(instancePath);

      expect(readMarketplaceLocation(malformedRegistryPath)).toBe(marketplacePath(instancePath));
      expect(
        logSpy.mock.calls.some(
          ([message]) =>
            String(message).includes('Skipping malformed marketplace registry') &&
            String(message).includes(malformedRegistryPath)
        )
      ).toBe(true);
    });

    it('keeps the instance-local registry valid under Windows copy fallback', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      spyOn(fs, 'symlinkSync').mockImplementation(() => {
        throw Object.assign(new Error('simulated symlink failure'), { code: 'EPERM' });
      });

      const globalRegistryPath = path.join(claudeDir(), 'plugins', 'known_marketplaces.json');
      writeJson(globalRegistryPath, {
        'claude-code-plugins': {
          installLocation: path.join(
            tempRoot,
            '.claude',
            'plugins',
            'marketplaces',
            'claude-code-plugins'
          ),
        },
      });

      const instancePath = instanceDir('personal');
      fs.mkdirSync(instancePath, { recursive: true });

      const manager = new SharedManager();
      manager.linkSharedDirectories(instancePath);

      const instanceRegistryPath = path.join(instancePath, 'plugins', 'known_marketplaces.json');
      expect(readMarketplaceLocation(globalRegistryPath)).toBe(marketplacePath(claudeDir()));
      expect(readMarketplaceLocation(instanceRegistryPath)).toBe(marketplacePath(instancePath));
      expect(fs.existsSync(path.join(instancePath, 'plugins', 'marketplaces'))).toBe(true);
    });
  });
});
