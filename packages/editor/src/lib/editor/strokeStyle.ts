import type { OutlineStrokeStyle } from "@shift/types";

/** The style a new dynamic stroke starts with until the user sets another: round, centred, 20 units. */
export const DEFAULT_STROKE_STYLE: OutlineStrokeStyle = {
  width: 20,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};
