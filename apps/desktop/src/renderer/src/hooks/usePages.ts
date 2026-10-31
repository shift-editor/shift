import type { NodeId } from "@shift/types";
import type { PageNode } from "@shift/editor/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/signals";

/** The document's pages in list order. */
export const usePages = (): readonly PageNode[] => {
  const editor = useEditor();
  return useSignalState(editor.pages.listCell);
};

/** The page the canvas shows, or null while the scene has no page. */
export const useActivePageId = (): NodeId | null => {
  const editor = useEditor();
  return useSignalState(editor.pages.activeCell);
};
