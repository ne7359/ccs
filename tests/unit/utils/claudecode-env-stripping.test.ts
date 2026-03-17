import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import { EventEmitter } from 'events';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type SpawnCall = {
  command: string;
  args: string[];
  options: Record<string, unknown> | undefined;
};

const spawnCalls: SpawnCall[] = [];
const originalPlatform = process.platform;
let baselineSigintListeners: Array<(...args: unknown[]) => void> = [];
let baselineSigtermListeners: Array<(...args: unknown[]) => void> = [];
let baselineSighupListeners: Array<(...args: unknown[]) => void> = [];
let originalCcsHome: string | undefined;
let originalDisableAutoUpdater: string | undefined;
const realSpawn = childProcess.spawn.bind(childProcess);
const realSpawnSync = childProcess.spawnSync.bind(childProcess);
const realExecSync = childProcess.execSync.bind(childProcess);

function createMockChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
  killed: boolean;
  pid: number;
  unref: () => EventEmitter;
  kill: () => boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    exitCode: number | null;
    killed: boolean;
    pid: number;
    unref: () => EventEmitter;
    kill: () => boolean;
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.pid = process.pid;
  child.unref = () => child;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 1;
    return true;
  };

  return child;
}

function shouldMockCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return normalized.includes('claude');
}

function registerChildProcessMock(): void {
  mock.module('child_process', () => ({
    ...childProcess,
    spawn: (...spawnArgs: unknown[]) => {
      const command = String(spawnArgs[0] ?? '');
      const maybeArgs = spawnArgs[1];
      const args = Array.isArray(maybeArgs) ? (maybeArgs as string[]) : [];
      const options = (Array.isArray(maybeArgs) ? spawnArgs[2] : spawnArgs[1]) as
        | Record<string, unknown>
        | undefined;

      if (!shouldMockCommand(command)) {
        return realSpawn(command, args, options as Parameters<typeof childProcess.spawn>[2]);
      }

      spawnCalls.push({ command, args, options });

      const child = createMockChild();
      setTimeout(() => child.emit('close', 0), 0);
      return child;
    },
    spawnSync: (...spawnArgs: unknown[]) => {
      const command = String(spawnArgs[0] ?? '');
      const maybeArgs = spawnArgs[1];
      const args = Array.isArray(maybeArgs) ? (maybeArgs as string[]) : [];
      const options = (Array.isArray(maybeArgs) ? spawnArgs[2] : spawnArgs[1]) as
        | Record<string, unknown>
        | undefined;

      return realSpawnSync(command, args, options as Parameters<typeof childProcess.spawnSync>[2]);
    },
    execSync: (...execArgs: unknown[]) =>
      realExecSync(
        execArgs[0] as Parameters<typeof childProcess.execSync>[0],
        execArgs[1] as Parameters<typeof childProcess.execSync>[1]
      ),
  }));
}

function writeConfigWithAutoUpdatePreference(enabled: boolean): void {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-auto-update-pref-'));
  process.env.CCS_HOME = tempHome;
  const ccsDir = path.join(tempHome, '.ccs');
  fs.mkdirSync(ccsDir, { recursive: true });
  const yaml = `version: 8
preferences:
  auto_update: ${enabled ? 'true' : 'false'}
`;
  fs.writeFileSync(path.join(ccsDir, 'config.yaml'), yaml, 'utf8');
}

let execClaude: typeof import('../../../src/utils/shell-executor').execClaude;
let stripClaudeCodeEnv: typeof import('../../../src/utils/shell-executor').stripClaudeCodeEnv;
let HeadlessExecutor: typeof import('../../../src/delegation/headless-executor').HeadlessExecutor;
let SharedManager: typeof import('../../../src/management/shared-manager').default;

beforeAll(async () => {
  registerChildProcessMock();

  const shellExecutor = await import('../../../src/utils/shell-executor');
  execClaude = shellExecutor.execClaude;
  stripClaudeCodeEnv = shellExecutor.stripClaudeCodeEnv;

  const sharedManagerModule = await import('../../../src/management/shared-manager');
  SharedManager = sharedManagerModule.default;

  const headless = await import('../../../src/delegation/headless-executor');
  HeadlessExecutor = headless.HeadlessExecutor;
});

afterAll(() => {
  mock.restore();
});

describe('CLAUDECODE environment stripping', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    process.env.CCS_QUIET = '1';
    originalCcsHome = process.env.CCS_HOME;
    originalDisableAutoUpdater = process.env.DISABLE_AUTOUPDATER;
    delete process.env.DISABLE_AUTOUPDATER;
    baselineSigintListeners = process.listeners('SIGINT');
    baselineSigtermListeners = process.listeners('SIGTERM');
    baselineSighupListeners = process.listeners('SIGHUP');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    delete process.env.CLAUDECODE;
    delete process.env.claudecode;
    delete process.env.CCS_QUIET;
    if (originalCcsHome !== undefined) process.env.CCS_HOME = originalCcsHome;
    else delete process.env.CCS_HOME;
    if (originalDisableAutoUpdater !== undefined) {
      process.env.DISABLE_AUTOUPDATER = originalDisableAutoUpdater;
    } else {
      delete process.env.DISABLE_AUTOUPDATER;
    }

    for (const listener of process.listeners('SIGINT')) {
      if (!baselineSigintListeners.includes(listener)) {
        process.removeListener('SIGINT', listener as (...args: unknown[]) => void);
      }
    }
    for (const listener of process.listeners('SIGTERM')) {
      if (!baselineSigtermListeners.includes(listener)) {
        process.removeListener('SIGTERM', listener as (...args: unknown[]) => void);
      }
    }
    for (const listener of process.listeners('SIGHUP')) {
      if (!baselineSighupListeners.includes(listener)) {
        process.removeListener('SIGHUP', listener as (...args: unknown[]) => void);
      }
    }
  });

  it('stripClaudeCodeEnv removes CLAUDECODE case-insensitively', () => {
    const input: NodeJS.ProcessEnv = {
      CLAUDECODE: 'upper',
      claudecode: 'lower',
      ClAuDeCoDe: 'mixed',
      PATH: '/usr/bin',
    };

    const result = stripClaudeCodeEnv(input);
    expect(Object.keys(result).map((k) => k.toUpperCase())).not.toContain('CLAUDECODE');
    expect(result.PATH).toBe('/usr/bin');
  });

  it('execClaude strips CLAUDECODE from merged env (including overrides)', () => {
    process.env.CLAUDECODE = 'from-parent';
    process.env.claudecode = 'from-parent-lower';

    execClaude('claude', ['--version'], {
      CCS_PROFILE_TYPE: 'default',
      CLAUDECODE: 'from-override',
      CCS_WEBSEARCH_SKIP: '1',
    });

    expect(spawnCalls.length).toBeGreaterThan(0);
    const env = spawnCalls[0].options?.env as NodeJS.ProcessEnv;
    expect(env).toBeDefined();
    expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain('CLAUDECODE');
    expect(env.CCS_WEBSEARCH_SKIP).toBe('1');
  });

  it('execClaude keeps behavior when CLAUDECODE is absent', () => {
    execClaude('claude', ['--help'], { CCS_PROFILE_TYPE: 'default' });

    expect(spawnCalls.length).toBeGreaterThan(0);
    const env = spawnCalls[0].options?.env as NodeJS.ProcessEnv;
    expect(env).toBeDefined();
    expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain('CLAUDECODE');
    expect(env.CCS_PROFILE_TYPE).toBe('default');
  });

  it('execClaude strips CLAUDECODE on Windows shell launch path', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.CLAUDECODE = 'set';

    execClaude('claude.cmd', ['--version'], { CCS_PROFILE_TYPE: 'default' });

    expect(spawnCalls.length).toBeGreaterThan(0);
    const env = spawnCalls[0].options?.env as NodeJS.ProcessEnv;
    expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain('CLAUDECODE');
  });

  it('execClaude sets DISABLE_AUTOUPDATER=1 when preferences.auto_update is false', () => {
    writeConfigWithAutoUpdatePreference(false);
    execClaude('claude', ['--version'], { CCS_PROFILE_TYPE: 'default' });

    expect(spawnCalls.length).toBeGreaterThan(0);
    const env = spawnCalls[0].options?.env as NodeJS.ProcessEnv;
    expect(env.DISABLE_AUTOUPDATER).toBe('1');
  });

  it('execClaude does not force DISABLE_AUTOUPDATER when preferences.auto_update is true', () => {
    writeConfigWithAutoUpdatePreference(true);
    execClaude('claude', ['--version'], { CCS_PROFILE_TYPE: 'default' });

    expect(spawnCalls.length).toBeGreaterThan(0);
    const env = spawnCalls[0].options?.env as NodeJS.ProcessEnv;
    expect(env.DISABLE_AUTOUPDATER).toBeUndefined();
  });

  it('execClaude normalizes shared plugin metadata before default-profile launch', () => {
    const normalizeSpy = spyOn(
      SharedManager.prototype,
      'normalizeSharedPluginMetadataPaths'
    ).mockImplementation(() => {});

    execClaude('claude', ['--help'], { CCS_PROFILE_TYPE: 'default' });

    expect(normalizeSpy).toHaveBeenCalledWith(undefined);
  });

  it('execClaude normalizes shared plugin metadata using CLAUDE_CONFIG_DIR when provided', () => {
    const normalizeSpy = spyOn(
      SharedManager.prototype,
      'normalizeSharedPluginMetadataPaths'
    ).mockImplementation(() => {});
    const instancePath = path.join(os.tmpdir(), 'ccs-shell-executor-instance');

    execClaude('claude', ['--help'], {
      CCS_PROFILE_TYPE: 'settings',
      CLAUDE_CONFIG_DIR: instancePath,
    });

    expect(normalizeSpy).toHaveBeenCalledWith(instancePath);
  });

  it('headless executor spawn path strips CLAUDECODE before spawn', async () => {
    writeConfigWithAutoUpdatePreference(false);
    process.env.CLAUDECODE = 'nested';
    process.env.claudecode = 'nested-lower';

    const result = await (
      HeadlessExecutor as unknown as {
        _spawnAndExecute: (
          claudeCli: string,
          args: string[],
          ctx: {
            cwd: string;
            profile: string;
            timeout: number;
            resumeSession: boolean;
            sessionId: string | null;
            sessionMgr: {
              updateSession: (...args: unknown[]) => void;
              storeSession: (...args: unknown[]) => void;
              cleanupExpired: () => void;
            };
          }
        ) => Promise<unknown>;
      }
    )._spawnAndExecute('claude', ['-p', 'test'], {
      cwd: process.cwd(),
      profile: 'glm',
      timeout: 1000,
      resumeSession: false,
      sessionId: null,
      sessionMgr: {
        updateSession: () => {},
        storeSession: () => {},
        cleanupExpired: () => {},
      },
    });

    expect(result).toBeDefined();
    expect(spawnCalls.length).toBeGreaterThan(0);
    const env = spawnCalls[0].options?.env as NodeJS.ProcessEnv;
    expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain('CLAUDECODE');
    expect(env.DISABLE_AUTOUPDATER).toBe('1');
  });
});
