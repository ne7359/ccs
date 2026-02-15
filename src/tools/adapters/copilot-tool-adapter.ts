import { COPILOT_SUBCOMMANDS, handleCopilotCommandLegacy } from '../../commands/copilot-command';
import type { ToolAdapter } from '../types';

export const copilotToolAdapter: ToolAdapter = {
  id: 'copilot',
  summary: 'GitHub Copilot integration commands',
  subcommands: COPILOT_SUBCOMMANDS,
  run: handleCopilotCommandLegacy,
};
