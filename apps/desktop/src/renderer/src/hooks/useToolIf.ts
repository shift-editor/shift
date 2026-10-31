import { signal, useSignalState, type Signal } from "@shift/editor/signals";
import type { ToolFor, ToolName } from "@shift/editor/tools";
import { useEditor } from "@/workspace/WorkspaceContext";

const NO_TOOL_STATE: Signal<null> = signal(null, { name: "useToolIf.noTool" });

/**
 * Follows one tool while it is active, re-rendering when the tool is switched
 * and whenever its state changes, so reads of its getters stay current.
 *
 * @param id - Tool identity the component follows.
 * @returns The active tool, typed by its identity, when it matches; otherwise null.
 */
export function useToolIf<Id extends ToolName>(id: Id): ToolFor<Id> | null {
  const editor = useEditor();
  const tool = useSignalState(editor.toolCellIf(id));
  const stateCell: Signal<unknown> = tool?.stateCell ?? NO_TOOL_STATE;
  useSignalState(stateCell);
  return tool;
}
