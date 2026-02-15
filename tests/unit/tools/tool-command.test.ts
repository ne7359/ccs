import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  handleToolCommand,
  type ToolCommandDependencies,
} from '../../../src/commands/tool-command';
import type { ToolAdapter } from '../../../src/tools/types';

describe('tool-command dispatch', () => {
  let logLines: string[] = [];
  let errorLines: string[] = [];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    logLines = [];
    errorLines = [];
    originalLog = console.log;
    originalError = console.error;
    console.log = (...args: unknown[]) => {
      logLines.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      errorLines.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  it('prints help when called without args', async () => {
    const deps = createDeps([]);
    const exitCode = await handleToolCommand([], deps);

    expect(exitCode).toBe(0);
    expect(
      logLines.some((line) => line.includes('Usage: ccs tool <id> <subcommand> [options]'))
    ).toBe(true);
  });

  it('returns error for unknown adapter', async () => {
    const deps = createDeps([]);
    const exitCode = await handleToolCommand(['missing', 'status'], deps);

    expect(exitCode).toBe(1);
    expect(errorLines.some((line) => line.includes('Unknown tool adapter: missing'))).toBe(true);
  });

  it('dispatches args to adapter', async () => {
    let receivedArgs: string[] = [];
    const adapter = makeAdapter('droid', (args) => {
      receivedArgs = args;
      return 7;
    });
    const deps = createDeps([adapter]);

    const exitCode = await handleToolCommand(['droid', 'doctor', '--verbose'], deps);

    expect(exitCode).toBe(7);
    expect(receivedArgs).toEqual(['doctor', '--verbose']);
  });

  it('falls back to adapter help when subcommand is missing', async () => {
    let receivedArgs: string[] = [];
    const adapter = makeAdapter('droid', (args) => {
      receivedArgs = args;
      return 0;
    });
    const deps = createDeps([adapter]);

    const exitCode = await handleToolCommand(['droid'], deps);

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual(['help']);
  });
});

function makeAdapter(id: string, run: (args: string[]) => number): ToolAdapter {
  return {
    id,
    summary: `${id} summary`,
    subcommands: ['help'],
    run,
  };
}

function createDeps(adapters: ToolAdapter[]): ToolCommandDependencies {
  return {
    getToolAdapter: (id: string) => adapters.find((adapter) => adapter.id === id),
    listToolAdapters: () => adapters,
  };
}
