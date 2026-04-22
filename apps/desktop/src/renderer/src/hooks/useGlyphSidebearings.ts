import type { GlyphSidebearings } from "@/lib/model/Glyph";
import { getEditor } from "@/store/store";
import { useSignalState, useSignalTrigger } from "@/lib/reactive";

const EMPTY_SIDEBEARINGS: GlyphSidebearings = { lsb: null, rsb: null };

/**
 * Current glyph sidebearings (LSB/RSB), live-updating.
 *
 * Subscribes to glyph identity, contour patches, and xAdvance; pulls the
 * lazy `glyph.sidebearings` getter at render time. Keeps the sidebearings
 * computation out of the drag hot path.
 *
 * @returns `{ lsb, rsb }` — both `null` when the glyph is unavailable.
 */
export function useGlyphSidebearings(): GlyphSidebearings {
  const editor = getEditor();
  const glyph = useSignalState(editor.glyph);
  useSignalTrigger(glyph?.$contours);
  useSignalTrigger(glyph?.$xAdvance);
  return glyph?.sidebearings ?? EMPTY_SIDEBEARINGS;
}
