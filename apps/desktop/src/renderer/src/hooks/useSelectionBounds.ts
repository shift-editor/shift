import { useMemo } from "react";
import { useValue } from "@/lib/reactive";
import { getEditor } from "@/store/store";
import type { SelectionBounds } from "@/types/transform";
import type { Rect2D } from "@shift/types";

export interface SelectionData {
  x: number;
  y: number;
  width: number;
  height: number;
  hasSelection: boolean;
  bounds: Rect2D | null;
  pointCount: number;
}

export function useSelectionBounds(): SelectionData {
  const editor = getEditor();
  const selectedPointIds = useValue(editor.selectedPointIds);

  return useMemo(() => {
    const pointCount = selectedPointIds.size;

    if (pointCount === 0) {
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        hasSelection: false,
        bounds: null,
        pointCount: 0,
      };
    }

    const selectionBounds: SelectionBounds | null = editor.getSelectionBounds();

    if (!selectionBounds) {
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        hasSelection: false,
        bounds: null,
        pointCount,
      };
    }

    const bounds: Rect2D = {
      x: selectionBounds.minX,
      y: selectionBounds.minY,
      width: selectionBounds.width,
      height: selectionBounds.height,
      left: selectionBounds.minX,
      top: selectionBounds.minY,
      right: selectionBounds.maxX,
      bottom: selectionBounds.maxY,
    };

    return {
      x: Math.round(selectionBounds.minX),
      y: Math.round(selectionBounds.minY),
      width: Math.round(selectionBounds.width),
      height: Math.round(selectionBounds.height),
      hasSelection: true,
      bounds,
      pointCount,
    };
  }, [selectedPointIds, editor]);
}
