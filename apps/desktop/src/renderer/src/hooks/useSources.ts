import { useMemo } from "react";
import type { Source } from "@shift/types";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";

/**
 * Variation sources/masters, or empty array when the font is not variable.
 * Each source's `location` is already resolved against the font's axes
 * (filled with axis defaults), so callers can index it directly by tag.
 */
export const useSources = (): Source[] => {
  const font = getEditor().font;
  const fontLoaded = useSignalState(font.$loaded);
  return useMemo(
    () => (fontLoaded && font.isVariable() ? font.getSources() : []),
    [fontLoaded, font],
  );
};
