/**
 * Unit tests for SharedManager - plugin registry path normalization
 */
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SharedManager, {
  normalizePluginMetadataPathString,
} from '../../src/management/shared-manager';

// Test the normalization regex pattern directly
const normalizePluginPaths = (content: string): string => {
  return normalizePluginMetadataPathString(content);
};

describe('SharedManager', () => {
  let tempRoot = '';
  let originalHome: string | undefined;
  let originalCcsHome: string | undefined;
  let originalCcsDir: string | undefined;
  let originalPlatform: PropertyDescriptor | undefined;

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

  describe('normalizePluginRegistryPaths', () => {
    describe('regex pattern', () => {
      it('should replace instance paths with canonical claude path', () => {
        const input = '/home/user/.ccs/instances/ck/plugins/cache/plugin/0.0.2';
        const expected = '/home/user/.claude/plugins/cache/plugin/0.0.2';
        expect(normalizePluginPaths(input)).toBe(expected);
      });

      it('should handle different instance names', () => {
        const inputs = [
          '/home/user/.ccs/instances/work/plugins/cache/plugin/1.0.0',
          '/home/user/.ccs/instances/personal/plugins/cache/plugin/1.0.0',
          '/home/user/.ccs/instances/test-account/plugins/cache/plugin/1.0.0',
        ];
        for (const input of inputs) {
          expect(normalizePluginPaths(input)).toContain('/.claude/');
          expect(normalizePluginPaths(input)).not.toContain('/.ccs/instances/');
        }
      });

      it('should handle multiple occurrences', () => {
        const input = JSON.stringify({
          plugins: {
            'plugin-a': [{ installPath: '/home/user/.ccs/instances/ck/plugins/a' }],
            'plugin-b': [{ installPath: '/home/user/.ccs/instances/work/plugins/b' }],
          },
        });
        const result = normalizePluginPaths(input);
        expect(result).not.toContain('/.ccs/instances/');
        expect(result.match(/\.claude/g)?.length).toBe(2);
      });

      it('should not modify already-canonical paths', () => {
        const input = '/home/user/.claude/plugins/cache/plugin/0.0.2';
        expect(normalizePluginPaths(input)).toBe(input);
      });

      it('should be idempotent', () => {
        const input = '/home/user/.ccs/instances/ck/plugins/cache/plugin/0.0.2';
        const first = normalizePluginPaths(input);
        const second = normalizePluginPaths(first);
        expect(first).toBe(second);
      });

      it('should preserve JSON structure', () => {
        const original = {
          version: 2,
          plugins: {
            'claude-hud@claude-hud': [
              {
                scope: 'user',
                installPath:
                  '/home/kai/.ccs/instances/ck/plugins/cache/claude-hud/claude-hud/0.0.2',
                version: '0.0.2',
              },
            ],
          },
        };
        const input = JSON.stringify(original, null, 2);
        const result = normalizePluginPaths(input);

        // Should be valid JSON
        expect(() => JSON.parse(result)).not.toThrow();

        // Should have normalized path
        const parsed = JSON.parse(result);
        expect(parsed.plugins['claude-hud@claude-hud'][0].installPath).toBe(
          '/home/kai/.claude/plugins/cache/claude-hud/claude-hud/0.0.2'
        );
      });

      it('should normalize marketplace installLocation values', () => {
        const original = {
          'claude-code-plugins': {
            installLocation:
              '/home/kai/.ccs/instances/work/plugins/marketplaces/claude-code-plugins',
          },
        };
        const input = JSON.stringify(original, null, 2);
        const result = normalizePluginPaths(input);

        expect(() => JSON.parse(result)).not.toThrow();

        const parsed = JSON.parse(result);
        expect(parsed['claude-code-plugins'].installLocation).toBe(
          '/home/kai/.claude/plugins/marketplaces/claude-code-plugins'
        );
      });
    });

    describe('edge cases', () => {
      it('should handle empty object', () => {
        const input = JSON.stringify({});
        expect(normalizePluginPaths(input)).toBe(input);
      });

      it('should handle plugins without installPath', () => {
        const input = JSON.stringify({ plugins: {} });
        expect(normalizePluginPaths(input)).toBe(input);
      });

      it('should handle Windows-style paths (backslash)', () => {
        const input = 'C:\\Users\\user\\.ccs\\instances\\ck\\plugins\\cache';
        expect(normalizePluginPaths(input)).toBe('C:\\Users\\user\\.claude\\plugins\\cache');
      });
    });
  });

  describe('normalizeMarketplaceRegistryPaths', () => {
    it('rewrites known_marketplaces.json on disk', () => {
      const pluginsDir = path.join(tempRoot, '.claude', 'plugins');
      fs.mkdirSync(pluginsDir, { recursive: true });

      const registryPath = path.join(pluginsDir, 'known_marketplaces.json');
      fs.writeFileSync(
        registryPath,
        JSON.stringify(
          {
            'claude-code-plugins': {
              installLocation:
                '/home/kai/.ccs/instances/work/plugins/marketplaces/claude-code-plugins',
            },
          },
          null,
          2
        ),
        'utf8'
      );

      const manager = new SharedManager();
      manager.normalizeMarketplaceRegistryPaths();

      const normalized = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      expect(normalized['claude-code-plugins'].installLocation).toBe(
        '/home/kai/.claude/plugins/marketplaces/claude-code-plugins'
      );
    });

    it('rewrites Windows-style known_marketplaces.json paths on disk', () => {
      const pluginsDir = path.join(tempRoot, '.claude', 'plugins');
      fs.mkdirSync(pluginsDir, { recursive: true });

      const registryPath = path.join(pluginsDir, 'known_marketplaces.json');
      fs.writeFileSync(
        registryPath,
        JSON.stringify(
          {
            'claude-code-plugins': {
              installLocation:
                'C:\\Users\\kai\\.ccs\\instances\\work\\plugins\\marketplaces\\claude-code-plugins',
            },
          },
          null,
          2
        ),
        'utf8'
      );

      const manager = new SharedManager();
      manager.normalizeMarketplaceRegistryPaths();

      const normalized = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      expect(normalized['claude-code-plugins'].installLocation).toBe(
        'C:\\Users\\kai\\.claude\\plugins\\marketplaces\\claude-code-plugins'
      );
    });

    it('normalizes copied shared and instance metadata under Windows fallback', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      spyOn(fs, 'symlinkSync').mockImplementation(() => {
        throw Object.assign(new Error('simulated symlink failure'), { code: 'EPERM' });
      });

      const pluginsDir = path.join(tempRoot, '.claude', 'plugins');
      fs.mkdirSync(pluginsDir, { recursive: true });

      const registryPath = path.join(pluginsDir, 'known_marketplaces.json');
      fs.writeFileSync(
        registryPath,
        JSON.stringify(
          {
            'claude-code-plugins': {
              installLocation:
                '/home/kai/.ccs/instances/work/plugins/marketplaces/claude-code-plugins',
            },
          },
          null,
          2
        ),
        'utf8'
      );

      const manager = new SharedManager();
      const instancePath = path.join(tempRoot, '.ccs', 'instances', 'personal');
      fs.mkdirSync(instancePath, { recursive: true });
      manager.linkSharedDirectories(instancePath);

      const expected = '/home/kai/.claude/plugins/marketplaces/claude-code-plugins';
      const claudeRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      const sharedRegistry = JSON.parse(
        fs.readFileSync(
          path.join(tempRoot, '.ccs', 'shared', 'plugins', 'known_marketplaces.json'),
          'utf8'
        )
      );
      const instanceRegistry = JSON.parse(
        fs.readFileSync(path.join(instancePath, 'plugins', 'known_marketplaces.json'), 'utf8')
      );

      expect(claudeRegistry['claude-code-plugins'].installLocation).toBe(expected);
      expect(sharedRegistry['claude-code-plugins'].installLocation).toBe(expected);
      expect(instanceRegistry['claude-code-plugins'].installLocation).toBe(expected);
    });
  });
});
