import { useCallback } from "react";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@/lib/signals";
import type { AxisLocation } from "@/types/variation";

export const useDesignLocation = (): [AxisLocation, (next: AxisLocation) => void] => {
  const editor = useEditor();
  const location = useSignalState(editor.$designLocation);

  const setLocation = useCallback((next: AxisLocation) => editor.setDesignLocation(next), [editor]);

  return [location, setLocation];
};
