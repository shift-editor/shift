import type { Axis } from "@shift/editor/model";
import { useFont } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/signals";

/**
 * Active variation axes, or empty array when the font is not variable.
 * Stable reference until the committed axis list changes. Slider scrubs update
 * external location, not the axis list, so they do not re-render subscribers.
 */
export const useAxes = (): readonly Axis[] => {
  const font = useFont();
  return useSignalState(font.axesCell);
};

/** Axes the user sets directly, without the internal axes mappings derive. */
export const useExternalAxes = (): readonly Axis[] => {
  const font = useFont();
  return useSignalState(font.externalAxesCell);
};
