import type { GlyphSidebearings } from "@/lib/model/Glyph";
import { getEditor } from "@/store/store";
import { useSignalState, useSignalTrigger } from "@/lib/signals";

const EMPTY_SIDEBEARINGS: GlyphSidebearings = { lsb: null, rsb: null };

export interface GlyphSidebearingsState {
  readonly sidebearings: GlyphSidebearings;
  readonly editable: boolean;
}

/**
 * Current glyph sidebearings (LSB/RSB), live-updating.
 *
 * Subscribes to the displayed glyph instance. Interpolated instances still
 * expose resolved values, but report `editable: false` so inputs can display
 * them without mutating a missing authored source.
 *
 * @returns Current values and whether the displayed instance can be edited.
 */
export function useGlyphSidebearings(): GlyphSidebearingsState {
  const editor = getEditor();
  const instance = useSignalState(editor.glyphInstanceCell);

  useSignalTrigger(instance?.sidebearingsCell, { schedule: "frame" });
  return {
    sidebearings: instance?.sidebearings ?? EMPTY_SIDEBEARINGS,
    editable: instance?.editable ?? false,
  };
}
