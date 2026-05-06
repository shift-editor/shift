import { useCallback } from "react";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/signals";
import type { AxisLocation } from "@/types/variation";

export const useDesignLocation = (): [AxisLocation, (next: AxisLocation) => void] => {
  const editor = getEditor();
  const location = useSignalState(editor.$designLocation);
  const setLocation = useCallback((next: AxisLocation) => editor.setDesignLocation(next), [editor]);

  return [location, setLocation];
};
