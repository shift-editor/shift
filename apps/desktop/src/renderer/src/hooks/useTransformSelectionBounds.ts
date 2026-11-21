import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/signals";
import type { TransformSelectionBounds } from "@shift/editor/types";

export function useTransformSelectionBounds(): TransformSelectionBounds | null {
  const editor = useEditor();
  return useSignalState(editor.transformSelectionBoundsCell, { schedule: "frame" });
}
