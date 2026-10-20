import type { EditorCommandId } from "@shared/commands";

/**
 * Runs a menu command in a tool window that has focus, or returns null when
 * none does. Tool windows share this renderer, so the native menu sends their
 * commands here.
 */
type ToolWindowCommandHandler = (id: EditorCommandId) => Promise<boolean> | null;

// non-reactive: read only when a menu command runs
const handlers = new Set<ToolWindowCommandHandler>();

/** Registers a focused tool window's command handler; returns a function that removes it. */
export function registerToolWindowCommands(handler: ToolWindowCommandHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Runs `id` in whichever tool window has focus; null when none does. */
export function runToolWindowCommand(id: EditorCommandId): Promise<boolean> | null {
  for (const handler of handlers) {
    const result = handler(id);
    if (result) return result;
  }
  return null;
}
