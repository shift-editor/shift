import type { SourceId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/lib/signals/index";

export const useEditingSourceIds = (): ReadonlySet<SourceId> => {
  const editor = useEditor();
  return useSignalState(editor.editingSourceIdsCell);
};
