import { fail } from '../utils/ui';
import { getToolAdapter, listToolAdapters } from '../tools';
import type { ToolAdapter } from '../tools';

export interface ToolCommandDependencies {
  getToolAdapter(id: string): ToolAdapter | undefined;
  listToolAdapters(): ToolAdapter[];
}

const DEFAULT_DEPS: ToolCommandDependencies = {
  getToolAdapter,
  listToolAdapters,
};

function showHelp(adapters: ToolAdapter[]): void {
  console.log('CCS Tool Adapters');
  console.log('');
  console.log('Usage: ccs tool <id> <subcommand> [options]');
  console.log('');
  console.log('Registered adapters:');
  for (const adapter of adapters) {
    console.log(`  ${adapter.id.padEnd(10)} ${adapter.summary}`);
  }
  console.log('');
  console.log('Examples:');
  console.log('  ccs tool droid setup');
  console.log('  ccs tool cursor auth');
  console.log('  ccs tool copilot status');
  console.log('');
}

function listAdapterIds(adapters: ToolAdapter[]): string {
  return adapters.map((adapter) => adapter.id).join(', ');
}

export async function handleToolCommand(
  args: string[],
  deps: ToolCommandDependencies = DEFAULT_DEPS
): Promise<number> {
  const adapters = deps.listToolAdapters();
  const adapterId = args[0];

  if (!adapterId || adapterId === 'help' || adapterId === '--help' || adapterId === '-h') {
    showHelp(adapters);
    return 0;
  }

  const adapter = deps.getToolAdapter(adapterId);
  if (!adapter) {
    console.error(fail(`Unknown tool adapter: ${adapterId}`));
    console.error(`Available adapters: ${listAdapterIds(adapters)}`);
    return 1;
  }

  const subArgs = args.slice(1);
  const effectiveArgs = subArgs.length > 0 ? subArgs : ['help'];
  return adapter.run(effectiveArgs);
}
