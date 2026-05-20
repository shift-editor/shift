import { getEditor } from "@/store/store";
import { useSignalState, useSignalTrigger } from "@/lib/signals";

export interface GlyphXAdvanceState {
  readonly xAdvance: number;
  readonly editable: boolean;
}

/**
 * Current glyph xAdvance, live-updating. Returns `0` when no glyph is loaded.
 */
export function useGlyphXAdvance(): GlyphXAdvanceState {
  const editor = getEditor();
  const instance = useSignalState(editor.glyphInstanceCell);

  useSignalTrigger(instance?.xAdvanceCell, { schedule: "frame" });

  return {
    xAdvance: instance?.xAdvance ?? 0,
    editable: instance?.editable ?? false,
  };
}
