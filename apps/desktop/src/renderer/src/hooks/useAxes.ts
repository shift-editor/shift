import { useMemo } from "react";
import type { Axis } from "@shift/types";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";

/**
 * Active variation axes, or empty array when the font is not variable.
 * Stable reference until the font reloads — components depending only on this
 * do not re-render on slider scrubs.
 */
export const useAxes = (): Axis[] => {
  const font = getEditor().font;
  const fontLoaded = useSignalState(font.$loaded);
  return useMemo(() => (fontLoaded && font.isVariable() ? font.getAxes() : []), [fontLoaded, font]);
};
