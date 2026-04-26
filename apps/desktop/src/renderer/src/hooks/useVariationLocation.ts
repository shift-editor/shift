import { useCallback } from "react";
import type { AxisLocation } from "@shift/types";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";

/**
 * Current variation location and a setter, backed by `font.$variationLocation`.
 * Multiple components reading this share one source of truth — no prop drilling.
 */
export const useVariationLocation = (): [AxisLocation, (next: AxisLocation) => void] => {
  const font = getEditor().font;
  const location = useSignalState(font.$variationLocation);
  const setLocation = useCallback((next: AxisLocation) => font.setVariationLocation(next), [font]);
  return [location, setLocation];
};
