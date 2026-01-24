import { useMemo } from "react";
import { useValue } from "@/lib/reactive";
import { getEditor } from "@/store/store";
import type { SelectionBounds } from "@/types/transform";

export interface SelectionData {
  x: number;
  y: number;
  width: number;
  height: number;
  hasSelection: boolean;
}

export function useSelectionBounds(): SelectionData {
  const editor = getEditor();
  const selectedPointIds = useValue(editor.selectedPointIds);

  return useMemo(() => {
    if (selectedPointIds.size === 0) {
      return { x: 0, y: 0, width: 0, height: 0, hasSelection: false };
    }

    const bounds: SelectionBounds | null = editor.getSelectionBounds();

    if (!bounds) {
      return { x: 0, y: 0, width: 0, height: 0, hasSelection: false };
    }

    return {
      x: Math.round(bounds.minX),
      y: Math.round(bounds.minY),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      hasSelection: true,
    };
  }, [selectedPointIds, editor]);
}
