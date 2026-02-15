export interface ToolAdapter {
  id: string;
  summary: string;
  subcommands: readonly string[];
  run(args: string[]): number | Promise<number>;
}
