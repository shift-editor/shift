import type { Bounds } from "@shift/geo";
import { getEditor } from "@/store/store";
import { useSignalState, useSignalTrigger } from "@/lib/reactive";

/**
 * Current selection bounds (axis-aligned, point-based), live-updating.
 *
 * Subscribes to the raw inputs that affect bounds (glyph identity, glyph
 * contour patches, and selected point ids), then pulls the lazy
 * `selection.bounds` getter at render time. This keeps the bounds
 * computation out of the reactive hot path during drag — the compute only
 * runs when React actually renders, which happens at most once per
 * animation frame.
 *
 * @returns The current selection bounds, or `null` when the glyph is
 * unavailable or nothing is selected.
 */
export function useSelectionBounds(): Bounds | null {
  const editor = getEditor();
  const glyph = useSignalState(editor.glyph);
  useSignalTrigger(glyph?.$contours);
  useSignalTrigger(editor.selection.$pointIds);
  return editor.selection.bounds;
}
