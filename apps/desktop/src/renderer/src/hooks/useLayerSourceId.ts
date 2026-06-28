import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@/lib/signals";

export const useLayerSourceId = (): string | null => {
  const editor = useEditor();
  return useSignalState(editor.layerSourceIdCell);
};
