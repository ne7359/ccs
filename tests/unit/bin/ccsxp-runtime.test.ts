import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

const wrapperPath = require.resolve('../../../src/bin/ccsxp-runtime.ts');
const ccsPath = require.resolve('../../../src/ccs.ts');

describe('ccsxp runtime wrapper', () => {
  const originalArgv = process.argv;
  const originalEntryTarget = process.env.CCS_INTERNAL_ENTRY_TARGET;

  beforeEach(() => {
    delete require.cache[wrapperPath];
    delete require.cache[ccsPath];
  });

  afterEach(() => {
    process.argv = originalArgv;

    if (originalEntryTarget === undefined) {
      delete process.env.CCS_INTERNAL_ENTRY_TARGET;
    } else {
      process.env.CCS_INTERNAL_ENTRY_TARGET = originalEntryTarget;
    }

    delete require.cache[wrapperPath];
    delete require.cache[ccsPath];
  });

  it('prepends the built-in codex profile and target before loading CCS', () => {
    process.argv = ['node', wrapperPath, 'fix failing tests'];
    require.cache[ccsPath] = { exports: {} } as NodeJS.Module;

    require(wrapperPath);

    expect(process.env.CCS_INTERNAL_ENTRY_TARGET).toBe('codex');
    expect(process.argv.slice(2)).toEqual(['codex', '--target', 'codex', 'fix failing tests']);
  });

  it('keeps flag-only invocations routed through the built-in codex profile shortcut', () => {
    process.argv = ['node', wrapperPath, '--version'];
    require.cache[ccsPath] = { exports: {} } as NodeJS.Module;

    require(wrapperPath);

    expect(process.argv.slice(2)).toEqual(['codex', '--target', 'codex', '--version']);
  });

  it('strips user-supplied target overrides before forcing the codex shortcut target', () => {
    process.argv = ['node', wrapperPath, '--target', 'claude', '--version'];
    require.cache[ccsPath] = { exports: {} } as NodeJS.Module;

    require(wrapperPath);

    expect(process.argv.slice(2)).toEqual(['codex', '--target', 'codex', '--version']);
  });
});
