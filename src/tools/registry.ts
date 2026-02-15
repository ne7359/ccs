import { copilotToolAdapter } from './adapters/copilot-tool-adapter';
import { cursorToolAdapter } from './adapters/cursor-tool-adapter';
import { droidToolAdapter } from './adapters/droid-tool-adapter';
import type { ToolAdapter, ToolRouteAuthMode, ToolRouteBinding } from './types';

const BUILTIN_TOOL_ADAPTERS: readonly ToolAdapter[] = [
  droidToolAdapter,
  cursorToolAdapter,
  copilotToolAdapter,
];

function normalizeToolId(id: string): string {
  return id.trim().toLowerCase();
}

function normalizeRoutePath(path: string): `/${string}` {
  const trimmed = path.trim();
  if (trimmed === '') {
    throw new Error('Tool route path cannot be empty');
  }
  if (!trimmed.startsWith('/')) {
    throw new Error(`Tool route path must start with '/': ${path}`);
  }
  const normalized = trimmed.replace(/\/+$/, '');
  return (normalized === '' ? '/' : normalized) as `/${string}`;
}

function validateAuthMode(mode: ToolRouteAuthMode | undefined, context: string): ToolRouteAuthMode {
  if (mode === 'required' || mode === 'optional') {
    return mode;
  }
  throw new Error(`Tool route is missing auth mode (${context})`);
}

function validateRouteBinding(binding: ToolRouteBinding, adapter: ToolAdapter): ToolRouteBinding {
  const normalizedPath = normalizeRoutePath(binding.path);
  const auth = validateAuthMode(binding.auth, `${adapter.id}:${binding.path}`);

  return {
    ...binding,
    path: normalizedPath,
    auth,
  };
}

export interface RegisteredToolRouteBinding extends ToolRouteBinding {
  toolId: string;
}

function freezeToolAdapter(adapter: ToolAdapter): ToolAdapter {
  return Object.freeze({
    ...adapter,
    subcommands: Object.freeze([...adapter.subcommands]),
    routes: adapter.routes
      ? Object.freeze(adapter.routes.map((binding) => Object.freeze({ ...binding })))
      : undefined,
  });
}

function buildToolAdapterMap(adapters: readonly ToolAdapter[]): Map<string, ToolAdapter> {
  const map = new Map<string, ToolAdapter>();
  for (const adapter of adapters) {
    const frozenAdapter = freezeToolAdapter(adapter);
    const normalizedId = normalizeToolId(adapter.id);
    if (normalizedId.length === 0) {
      throw new Error('Tool adapter id cannot be empty');
    }
    const existing = map.get(normalizedId);
    if (existing) {
      throw new Error(
        `Duplicate tool adapter id '${adapter.id}' conflicts with '${existing.id}' (normalized: '${normalizedId}')`
      );
    }
    map.set(normalizedId, frozenAdapter);
  }
  return map;
}

function buildToolRouteBindings(adapters: readonly ToolAdapter[]): RegisteredToolRouteBinding[] {
  const bindings: RegisteredToolRouteBinding[] = [];
  const seenRouteKeys = new Set<string>();

  for (const adapter of adapters) {
    for (const binding of adapter.routes ?? []) {
      const validatedBinding = validateRouteBinding(binding, adapter);
      const routeKey = `${normalizeToolId(adapter.id)}:${validatedBinding.path}`;
      if (seenRouteKeys.has(routeKey)) {
        throw new Error(`Duplicate tool route binding detected (${routeKey})`);
      }
      seenRouteKeys.add(routeKey);
      bindings.push(
        Object.freeze({
          ...validatedBinding,
          toolId: adapter.id,
        })
      );
    }
  }

  return bindings;
}

const toolAdapterMap = buildToolAdapterMap(BUILTIN_TOOL_ADAPTERS);
const toolRouteBindings = buildToolRouteBindings([...toolAdapterMap.values()]);

export function validateToolAdaptersForStartup(adapters: readonly ToolAdapter[]): void {
  buildToolRouteBindings([...buildToolAdapterMap(adapters).values()]);
}

export function listToolAdapters(): ToolAdapter[] {
  return [...toolAdapterMap.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getToolAdapter(id: string): ToolAdapter | undefined {
  return toolAdapterMap.get(normalizeToolId(id));
}

export function listToolRouteBindings(): RegisteredToolRouteBinding[] {
  return [...toolRouteBindings];
}

export function hasToolSubcommand(toolId: string, subcommand: string | undefined): boolean {
  if (!subcommand) {
    return false;
  }

  const adapter = getToolAdapter(toolId);
  if (!adapter) {
    return false;
  }

  return adapter.subcommands.includes(subcommand);
}

export async function dispatchToolAdapter(toolId: string, args: string[]): Promise<number> {
  const adapter = getToolAdapter(toolId);
  if (!adapter) {
    throw new Error(`Unknown tool adapter: ${toolId}`);
  }

  const exitCode = await adapter.run(args);
  return typeof exitCode === 'number' ? exitCode : 0;
}
