import type { ShiftEditorReader } from "./ShiftEditorReader";
import type { ShiftFontReader } from "./ShiftFontReader";
import type { ShiftKerningReader } from "./ShiftKerningReader";

/**
 * The app's readers one window serves, by the name an `agent.read` call gives each: the read
 * layer MCP agents, the Playwright `EditorDriver` and vitest's `TestEditor` all read through.
 *
 * @remarks
 * Not every read here is published to MCP; the runtime's capabilities choose which are.
 */
export interface AppReaders {
  font: ShiftFontReader;
  kerning: ShiftKerningReader;
  editor: ShiftEditorReader;
}
