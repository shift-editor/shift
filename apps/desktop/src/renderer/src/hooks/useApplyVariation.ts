import { useCallback, useEffect, useRef } from "react";
import type { AxisLocation, GlyphVariationData } from "@shift/types";
import { getEditor } from "@/store/store";
import { interpolate, normalize } from "@/lib/interpolation/interpolate";
import { useAxes } from "./useAxes";
import { useVariationLocation } from "./useVariationLocation";

/**
 * Returns a callback that sets the variation location and applies the
 * resulting interpolated values to the active glyph. Caches the active glyph's
 * variation data in a ref so slider scrubs never go back to Rust.
 */
export const useApplyVariation = (): ((next: AxisLocation) => void) => {
  const editor = getEditor();
  const font = editor.font;
  const axes = useAxes();
  const [, setLocation] = useVariationLocation();

  const variationDataRef = useRef<GlyphVariationData | null>(null);
  const editingGlyph = editor.getActiveGlyphName();
  useEffect(() => {
    variationDataRef.current =
      axes.length > 0 && editingGlyph ? font.getGlyphVariationData(editingGlyph) : null;
  }, [axes, editingGlyph, font]);

  return useCallback(
    (next: AxisLocation) => {
      setLocation(next);
      const data = variationDataRef.current;
      if (!data) return;
      const values = interpolate(data, normalize(next, axes));
      const glyph = editor.glyph.peek();
      if (glyph) glyph.applyValues(values);
    },
    [axes, editor, setLocation],
  );
};
