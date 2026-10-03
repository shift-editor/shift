import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/signals";
import type { LocalBounds } from "@shift/editor/spaces";

/**
 * Current selection bounds in the selected glyph's units.
 *
 * @returns null when the selection has no bounded objects or spans several nodes.
 */
export function useSelectionBounds(): LocalBounds | null {
  const editor = useEditor();
  return useSignalState(editor.selectionBoundsCell, { schedule: "frame" });
}
