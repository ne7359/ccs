import { copilotToolAdapter } from './adapters/copilot-tool-adapter';
import { cursorToolAdapter } from './adapters/cursor-tool-adapter';
import { droidToolAdapter } from './adapters/droid-tool-adapter';
import type { ToolAdapter } from './types';

const BUILTIN_TOOL_ADAPTERS: readonly ToolAdapter[] = [
  droidToolAdapter,
  cursorToolAdapter,
  copilotToolAdapter,
];

const toolAdapterMap = new Map<string, ToolAdapter>();

for (const adapter of BUILTIN_TOOL_ADAPTERS) {
  toolAdapterMap.set(adapter.id.toLowerCase(), adapter);
}

function normalizeToolId(id: string): string {
  return id.trim().toLowerCase();
}

export function listToolAdapters(): ToolAdapter[] {
  return [...toolAdapterMap.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getToolAdapter(id: string): ToolAdapter | undefined {
  return toolAdapterMap.get(normalizeToolId(id));
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
