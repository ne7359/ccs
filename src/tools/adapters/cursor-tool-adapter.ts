import { CURSOR_SUBCOMMANDS, handleCursorCommandLegacy } from '../../commands/cursor-command';
import type { ToolAdapter } from '../types';

export const cursorToolAdapter: ToolAdapter = {
  id: 'cursor',
  summary: 'Cursor IDE integration commands',
  subcommands: CURSOR_SUBCOMMANDS,
  run: handleCursorCommandLegacy,
};
