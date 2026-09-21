import type { SourceId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/signals";

export const useActiveSourceId = (): SourceId | null => {
  const editor = useEditor();
  return useSignalState(editor.activeSourceIdCell);
};
