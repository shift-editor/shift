import { useCallback } from "react";
import type { AxisLocation } from "@shift/types";
import { getEditor } from "@/store/store";

/**
 * Returns a callback that pushes the given variation `location` through the
 * editor — sets the shared `$variationLocation` and applies interpolated
 * values to the active editable Glyph. All bookkeeping (cached variation
 * data, "what's the active glyph") lives on `Editor` so this hook stays a
 * thin React→Editor adapter.
 */
export const useApplyVariation = (): ((next: AxisLocation) => void) => {
  const editor = getEditor();
  return useCallback((next: AxisLocation) => editor.applyVariation(next), [editor]);
};
