import type { Axis } from "@shift/types";
import { getEditor } from "@/store/appStore";
import { useSignalState } from "@/lib/signals";

/**
 * Active variation axes, or empty array when the font is not variable.
 * Stable reference until the committed axis list changes. Slider scrubs update
 * design location, not the axis list, so they do not re-render subscribers.
 */
export const useAxes = (): Axis[] => {
  const font = getEditor().font;
  return useSignalState(font.axesCell);
};
