import { Loader2, Wrench } from 'lucide-react';
import { Navigate, useParams } from 'react-router-dom';
import { useTool } from '@/hooks/use-tool';
import { CopilotPage } from './copilot';
import { CursorPage } from './cursor';
import { DroidPage } from './droid';

const TOOL_PAGE_COMPONENTS: Record<string, () => JSX.Element> = {
  copilot: CopilotPage,
  cursor: CursorPage,
  droid: DroidPage,
};

export function ToolPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const { tool, isLoading, error, isRegistryReady } = useTool(toolId);

  if (!toolId) {
    return <Navigate to="/" replace />;
  }

  const ToolComponent = TOOL_PAGE_COMPONENTS[toolId];
  if (ToolComponent) {
    return <ToolComponent />;
  }

  if (isLoading && !tool) {
    return (
      <div className="flex h-[260px] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!tool && error) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="rounded-xl border border-border bg-card p-6 space-y-3">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Wrench className="h-5 w-5" />
            <span>{toolId}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Tool registry is temporarily unavailable, but this route may still be valid.
          </p>
          <p className="text-sm text-muted-foreground">
            Use the CLI command: <code className="font-mono">ccs tool {toolId} help</code>
          </p>
          <p className="text-xs text-red-500">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!tool && isRegistryReady) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="rounded-xl border border-border bg-card p-6 space-y-3">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Wrench className="h-5 w-5" />
            <span>{toolId}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Tool is not registered in this CCS installation.
          </p>
          <p className="text-sm text-muted-foreground">
            List available tools with: <code className="font-mono">ccs tool help</code>
          </p>
        </div>
      </div>
    );
  }

  if (!tool) {
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Wrench className="h-5 w-5" />
          <span>{tool.label}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          This tool is registered in CCS, but a dedicated dashboard module is not available yet.
        </p>
        <p className="text-sm text-muted-foreground">
          Use the CLI command: <code className="font-mono">ccs tool {tool.id} help</code>
        </p>
      </div>
    </div>
  );
}
