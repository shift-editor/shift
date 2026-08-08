import { useCallback } from "react";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@/lib/signals";
import type { ExternalAxisLocation } from "@/types/variation";

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
