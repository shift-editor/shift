import { useEffect, useMemo } from "react";
import type { GlyphId } from "@shift/types";
import type { Signal } from "@/lib/signals";
import { useSignalState } from "@/lib/signals";
import type { Font } from "@/lib/model/Font";
import type { GlyphView } from "@/lib/model/Glyph";
import type { AxisLocation } from "@/types/variation";

/**
 * Returns location-bound glyph views and requests any missing lightweight backing.
 *
 * @remarks
 * Projection reads are keyed only by glyph identity. The returned views follow
 * `location` through Shift's signal graph, so scrubbing evaluates the currently
 * observed views without issuing bridge reads or retaining old locations.
 *
 * @param font - Font that owns the glyphs and their projection backing.
 * @param glyphIds - Stable ordered glyph identities needed by the caller.
 * @param location - Shared reactive designspace location for every returned view.
 * @returns Views aligned with `glyphIds`; entries remain `null` until backing arrives.
 */
export function useGlyphViews(
  font: Font,
  glyphIds: readonly GlyphId[],
  location: Signal<AxisLocation>,
): readonly (GlyphView | null)[] {
  const viewsCell = useMemo(
    () => font.glyphViewsCell(glyphIds, location),
    [font, glyphIds, location],
  );
  const views = useSignalState(viewsCell);

  useEffect(() => {
    async function requestViews(): Promise<void> {
      try {
        await font.requestGlyphViews(glyphIds);
      } catch (error) {
        console.error("failed to read glyph projections", error);
      }
    }

    void requestViews();
  }, [font, glyphIds, views]);

  return views;
}
