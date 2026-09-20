import { useCallback } from "react";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/lib/signals/index";
import type { ExternalAxisLocation } from "@shift/editor/types/variation";

export const useExternalLocation = (): [
  ExternalAxisLocation,
  (next: ExternalAxisLocation) => void,
] => {
  const editor = useEditor();
  const location = useSignalState(editor.externalLocationCell);

  const setLocation = useCallback(
    (next: ExternalAxisLocation) => editor.setExternalLocation(next),
    [editor],
  );

  return [location, setLocation];
};
