import { getEditor } from "@/store/store";
import { useSignalState, useSignalTrigger } from "@/lib/signals";

/**
 * Current glyph xAdvance, live-updating. Returns `0` when no glyph is loaded.
 */
export function useGlyphXAdvance(): number {
  const editor = getEditor();
  const glyph = useSignalState(editor.glyph);
  useSignalTrigger(glyph?.$xAdvance);
  return glyph?.xAdvance ?? 0;
}
