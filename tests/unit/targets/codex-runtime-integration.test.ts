import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCcs(args: string[], env: NodeJS.ProcessEnv): RunResult {
  const ccsEntry = path.join(process.cwd(), 'src', 'ccs.ts');
  const result = spawnSync(process.execPath, [ccsEntry, ...args], {
    encoding: 'utf8',
    env,
    timeout: 20000,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runCodexAlias(args: string[], env: NodeJS.ProcessEnv): RunResult {
  const codexEntry = path.join(process.cwd(), 'src', 'bin', 'codex-runtime.ts');
  const result = spawnSync(process.execPath, [codexEntry, ...args], {
    encoding: 'utf8',
    env,
    timeout: 20000,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runCcsxpAlias(args: string[], env: NodeJS.ProcessEnv): RunResult {
  const ccsxpEntry = path.join(process.cwd(), 'src', 'bin', 'ccsxp-runtime.ts');
  const result = spawnSync(process.execPath, [ccsxpEntry, ...args], {
    encoding: 'utf8',
    env,
    timeout: 20000,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readLoggedCodexCalls(logPath: string): string[][] {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  return fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function readLoggedCodexEnv(logPath: string): Record<string, string | undefined>[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  return fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, string | undefined>);
}

describe('codex runtime integration', () => {
  let tmpHome: string;
  let ccsDir: string;
  let fakeCodexPath: string;
  let codexArgsLogPath: string;
  let codexEnvLogPath: string;
  let emptyPathDir: string;

  beforeEach(() => {
    if (process.platform === 'win32') {
      return;
    }

    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-codex-route-it-'));
    ccsDir = path.join(tmpHome, '.ccs');
    fakeCodexPath = path.join(tmpHome, 'fake-codex.js');
    codexArgsLogPath = path.join(tmpHome, 'codex-args.log');
    codexEnvLogPath = path.join(tmpHome, 'codex-env.log');
    emptyPathDir = path.join(tmpHome, 'empty-bin');

    fs.mkdirSync(ccsDir, { recursive: true });
    fs.mkdirSync(emptyPathDir, { recursive: true });

    fs.writeFileSync(
      fakeCodexPath,
      `#!/usr/bin/env node
const fs = require('fs');
const out = process.env.CCS_TEST_CODEX_ARGS_OUT;
const cliArgs = process.argv.slice(2);
if (out) {
  fs.appendFileSync(out, JSON.stringify(cliArgs) + '\\n');
}
const envOut = process.env.CCS_TEST_CODEX_ENV_OUT;
if (envOut) {
  fs.appendFileSync(
    envOut,
    JSON.stringify({
      CODEX_HOME: process.env.CODEX_HOME,
      CODEX_CI: process.env.CODEX_CI,
      CODEX_MANAGED_BY_BUN: process.env.CODEX_MANAGED_BY_BUN,
      CODEX_THREAD_ID: process.env.CODEX_THREAD_ID,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    }) + '\\n'
  );
}
if (cliArgs.includes('--version') || cliArgs.includes('-v')) {
  process.stdout.write(process.env.CCS_TEST_CODEX_VERSION || 'codex-cli 0.118.0-alpha.3');
  process.exit(0);
}
if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
  process.stdout.write(
    process.env.CCS_TEST_CODEX_HELP ||
      '  -c, --config <key=value>\\n  -p, --profile <CONFIG_PROFILE>\\n'
  );
  process.exit(0);
}
process.exit(0);
`,
      { encoding: 'utf8', mode: 0o755 }
    );
    fs.chmodSync(fakeCodexPath, 0o755);
  });

  afterEach(() => {
    if (process.platform === 'win32') {
      return;
    }

    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('does not preflight native Codex default launches when no runtime overrides are needed', () => {
    if (process.platform === 'win32') return;

    const result = runCcs(['default', '--target', 'codex', 'fix failing tests'], {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      CCS_HOME: tmpHome,
      CCS_CODEX_PATH: fakeCodexPath,
      CCS_TEST_CODEX_ARGS_OUT: codexArgsLogPath,
      CCS_THINKING: '8192',
    });

    expect(result.status).toBe(0);
    const calls = readLoggedCodexCalls(codexArgsLogPath);
    expect(calls).toEqual([['fix failing tests']]);
  });

  it('ignores off-style CCS_THINKING env overrides for native Codex default mode', () => {
    if (process.platform === 'win32') return;

    const result = runCcs(['default', '--target', 'codex', 'fix failing tests'], {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      CCS_HOME: tmpHome,
      CCS_CODEX_PATH: fakeCodexPath,
      CCS_TEST_CODEX_ARGS_OUT: codexArgsLogPath,
      CCS_THINKING: 'off',
    });

    expect(result.status).toBe(0);
    const calls = readLoggedCodexCalls(codexArgsLogPath);
    expect(calls).toEqual([['fix failing tests']]);
  });

  for (const versionFlag of ['--version', '-v']) {
    it(`passes ccsx ${versionFlag} straight through to the native Codex binary`, () => {
      if (process.platform === 'win32') return;

      const result = runCodexAlias([versionFlag], {
        ...process.env,
        CI: '1',
        NO_COLOR: '1',
        CCS_HOME: tmpHome,
        CCS_CODEX_PATH: fakeCodexPath,
        CCS_TEST_CODEX_ARGS_OUT: codexArgsLogPath,
        CCS_TEST_CODEX_VERSION: 'codex-cli 9.9.9-test',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('codex-cli 9.9.9-test');
      expect(readLoggedCodexCalls(codexArgsLogPath)).toEqual([[versionFlag]]);
    });
  }

  for (const helpFlag of ['--help', '-h']) {
    it(`passes ccsx ${helpFlag} straight through to the native Codex binary`, () => {
      if (process.platform === 'win32') return;

      const result = runCodexAlias([helpFlag], {
        ...process.env,
        CI: '1',
        NO_COLOR: '1',
        CCS_HOME: tmpHome,
        CCS_CODEX_PATH: fakeCodexPath,
        CCS_TEST_CODEX_ARGS_OUT: codexArgsLogPath,
        CCS_TEST_CODEX_HELP: 'codex native help text',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('codex native help text');
      expect(readLoggedCodexCalls(codexArgsLogPath)).toEqual([[helpFlag]]);
    });
  }

  it('strips nested Codex session env from passthrough launches while keeping CODEX_HOME', () => {
    if (process.platform === 'win32') return;

    const result = runCodexAlias(['--version'], {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      CCS_HOME: tmpHome,
      CCS_CODEX_PATH: fakeCodexPath,
      CCS_TEST_CODEX_ARGS_OUT: codexArgsLogPath,
      CCS_TEST_CODEX_ENV_OUT: codexEnvLogPath,
      CCS_TEST_CODEX_VERSION: 'codex-cli 9.9.9-test',
      CODEX_HOME: '/tmp/codex-home',
      CODEX_CI: '1',
      CODEX_MANAGED_BY_BUN: '1',
      CODEX_THREAD_ID: 'thread-123',
      ANTHROPIC_BASE_URL: 'https://stale-proxy.invalid',
    });

    expect(result.status).toBe(0);
    expect(readLoggedCodexCalls(codexArgsLogPath)).toEqual([['--version']]);
    expect(readLoggedCodexEnv(codexEnvLogPath)).toEqual([
      {
        CODEX_HOME: '/tmp/codex-home',
        CODEX_CI: undefined,
        CODEX_MANAGED_BY_BUN: undefined,
        CODEX_THREAD_ID: undefined,
        ANTHROPIC_BASE_URL: undefined,
      },
    ]);
  });

  it('keeps ccsxp pinned to native Codex even when a user passes another --target override', () => {
    if (process.platform === 'win32') return;

    const result = runCcsxpAlias(['--target', 'claude', '--version'], {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      CCS_HOME: tmpHome,
      CCS_CODEX_PATH: fakeCodexPath,
      CCS_TEST_CODEX_ARGS_OUT: codexArgsLogPath,
      CCS_TEST_CODEX_VERSION: 'codex-cli 9.9.9-test',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('codex-cli 9.9.9-test');
    expect(readLoggedCodexCalls(codexArgsLogPath)).toEqual([['--version']]);
  });

  it('fails with a clean CLI error when ccsxp receives a malformed --target flag', () => {
    if (process.platform === 'win32') return;

    const result = runCcsxpAlias(['--target'], {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      CCS_HOME: tmpHome,
      CCS_CODEX_PATH: fakeCodexPath,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[X] --target requires a value (claude, droid, codex)');
    expect(result.stderr).not.toContain('at parseTargetFlags');
  });

  it('passes ccs codex --target codex --version through to the native Codex binary', () => {
    if (process.platform === 'win32') return;

    const result = runCcs(['codex', '--target', 'codex', '--version'], {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      CCS_HOME: tmpHome,
      CCS_CODEX_PATH: fakeCodexPath,
      CCS_TEST_CODEX_ARGS_OUT: codexArgsLogPath,
      CCS_TEST_CODEX_VERSION: 'codex-cli 9.9.9-test',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('codex-cli 9.9.9-test');
    expect(readLoggedCodexCalls(codexArgsLogPath)).toEqual([['--version']]);
  });

  it('fails fast when native Codex reasoning overrides need unsupported --config support', () => {
    if (process.platform === 'win32') return;

    const result = runCcs(
      ['default', '--target', 'codex', '--effort', 'high', 'fix failing tests'],
      {
        ...process.env,
        CI: '1',
        NO_COLOR: '1',
        CCS_HOME: tmpHome,
        CCS_CODEX_PATH: fakeCodexPath,
        CCS_TEST_CODEX_ARGS_OUT: codexArgsLogPath,
        CCS_TEST_CODEX_VERSION: 'codex-cli 9.9.9-test',
        CCS_TEST_CODEX_HELP: '  -p, --profile <CONFIG_PROFILE>\\n',
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Codex CLI (codex-cli 9.9.9-test)');
    expect(result.stderr).toContain('does not advertise --config overrides');
    const calls = readLoggedCodexCalls(codexArgsLogPath);
    expect(calls).toEqual([['--help'], ['--version']]);
  });

  it('reports unsupported generic settings profiles before Codex install guidance', () => {
    if (process.platform === 'win32') return;

    const settingsPath = path.join(ccsDir, 'myglm.settings.json');
    const configPath = path.join(ccsDir, 'config.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: 'https://example.invalid/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'test-token',
            ANTHROPIC_MODEL: 'gpt-5.4',
          },
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          profiles: {
            myglm: settingsPath,
          },
        },
        null,
        2
      )
    );

    const result = runCcs(['myglm', '--target', 'codex', 'fix failing tests'], {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      CCS_HOME: tmpHome,
      PATH: emptyPathDir,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Codex CLI currently supports native default sessions and Codex-routed CLIProxy sessions only.'
    );
    expect(result.stderr).not.toContain('Install a recent @openai/codex build');
  });
});
