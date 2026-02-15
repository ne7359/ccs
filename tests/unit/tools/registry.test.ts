import { describe, it, expect } from 'bun:test';
import { Router } from 'express';
import {
  getToolAdapter,
  hasToolSubcommand,
  listToolAdapters,
  listToolRouteBindings,
  validateToolAdaptersForStartup,
} from '../../../src/tools/registry';
import type { ToolAdapter } from '../../../src/tools/types';

describe('tool registry', () => {
  it('registers built-in adapters', () => {
    const ids = listToolAdapters().map((adapter) => adapter.id);
    expect(ids).toEqual(['copilot', 'cursor', 'droid']);
  });

  it('resolves adapters case-insensitively', () => {
    expect(getToolAdapter('CuRsOr')?.id).toBe('cursor');
  });

  it('returns undefined for unknown adapter', () => {
    expect(getToolAdapter('unknown')).toBeUndefined();
  });

  it('returns immutable adapter metadata to prevent test leakage', () => {
    const adapter = getToolAdapter('droid');
    expect(adapter).toBeDefined();

    expect(() => {
      (adapter?.subcommands as string[]).push('mutated');
    }).toThrow();
    expect(getToolAdapter('droid')?.subcommands.includes('mutated')).toBe(false);
  });

  it('reports known subcommands', () => {
    expect(hasToolSubcommand('droid', 'setup')).toBe(true);
    expect(hasToolSubcommand('droid', 'missing')).toBe(false);
  });

  it('exposes API route bindings for tools with web modules', () => {
    const bindings = listToolRouteBindings();
    const routeIds = bindings.map((binding) => binding.toolId);

    expect(routeIds).toContain('copilot');
    expect(routeIds).toContain('cursor');
    expect(routeIds).toContain('droid');
    expect(bindings.every((binding) => binding.auth === 'required' || binding.auth === 'optional')).toBe(
      true
    );
    expect(() => {
      (bindings[0] as { path: string }).path = '/mutated';
    }).toThrow();
    expect(listToolRouteBindings()[0]?.path).not.toBe('/mutated');
  });

  it('rejects duplicate adapter IDs at startup validation', () => {
    const adapters: ToolAdapter[] = [
      {
        id: 'demo',
        summary: 'Demo A',
        subcommands: [],
        run: () => 0,
      },
      {
        id: 'DEMO',
        summary: 'Demo B',
        subcommands: [],
        run: () => 0,
      },
    ];

    expect(() => validateToolAdaptersForStartup(adapters)).toThrow(/duplicate tool adapter id/i);
  });

  it('rejects duplicate route bindings after path normalization', () => {
    const routerA = Router();
    const routerB = Router();
    const adapters: ToolAdapter[] = [
      {
        id: 'demo',
        summary: 'Demo',
        subcommands: [],
        routes: [
          { path: '/status', auth: 'required', router: routerA },
          { path: '/status/', auth: 'required', router: routerB },
        ],
        run: () => 0,
      },
    ];

    expect(() => validateToolAdaptersForStartup(adapters)).toThrow(/duplicate tool route binding/i);
  });

  it('rejects invalid route paths that do not start with slash', () => {
    const adapters: ToolAdapter[] = [
      {
        id: 'demo',
        summary: 'Demo',
        subcommands: [],
        routes: [
          {
            path: 'status' as `/${string}`,
            auth: 'required',
            router: Router(),
          },
        ],
        run: () => 0,
      },
    ];

    expect(() => validateToolAdaptersForStartup(adapters)).toThrow(/must start with '\//i);
  });
});
