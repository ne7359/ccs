import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { runCopilotToolSubcommand } from '../../../src/tools/adapters/copilot-tool-runtime';

describe('copilot-tool-runtime', () => {
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

  it('returns success for help subcommand', async () => {
    const exitCode = await runCopilotToolSubcommand(['help']);
    expect(exitCode).toBe(0);
    expect(logLines.some((line) => line.includes('GitHub Copilot Integration'))).toBe(true);
  });

  it('returns non-zero for unknown subcommands', async () => {
    const exitCode = await runCopilotToolSubcommand(['unknown-subcommand']);
    expect(exitCode).toBe(1);
    expect(errorLines.some((line) => line.includes('Unknown subcommand'))).toBe(true);
  });
});
