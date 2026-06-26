import type { GlyphSidebearings } from "@/lib/model/Glyph";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState, useSignalTrigger } from "@/lib/signals";

const EMPTY_SIDEBEARINGS: GlyphSidebearings = { lsb: null, rsb: null };

export interface GlyphSidebearingsState {
  readonly sidebearings: GlyphSidebearings;
  readonly hasLayer: boolean;
}

/**
 * Current glyph sidebearings (LSB/RSB), live-updating.
 *
 * Subscribes to the displayed glyph instance. Interpolated instances still
 * expose resolved values, but report `hasLayer: false` so inputs can display
 * them without mutating a missing authored glyph layer.
 *
 * @returns Current values and whether the displayed instance can be edited.
 */
export function useGlyphSidebearings(): GlyphSidebearingsState {
  const editor = useEditor();
  const instance = useSignalState(editor.glyphInstanceCell);

  useSignalTrigger(instance?.sidebearingsCell, { schedule: "frame" });
  return {
    sidebearings: instance?.sidebearings ?? EMPTY_SIDEBEARINGS,
    hasLayer: instance?.hasLayer ?? false,
  };
}
