import { Bounds, type Bounds as BoundsType } from "@shift/geo";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@/lib/signals";

/**
 * Current selection bounds.
 *
 * @returns null when the current selection has no bounded objects.
 */
export function useSelectionBounds(): BoundsType | null {
  const editor = useEditor();
  const rect = useSignalState(editor.selectionBoundsCell, { schedule: "frame" });
  if (!rect) return null;

  return Bounds.fromXYWH(rect.x, rect.y, rect.width, rect.height);
}
