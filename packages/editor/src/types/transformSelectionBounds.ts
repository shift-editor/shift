import type { ContourId, LayerId } from "@shift/types";
import type { LocalBounds } from "../spaces";

/** Which geometry the transform panel's numeric fields show. */
export type TransformBoundsMeasure = "ink" | "skeleton";

/** Ink box edge targeted by a transform resize (`FitInkBound`). */
export type InkBoundEdge = "left" | "right" | "top" | "bottom";

/**
 * Bounds shown in the transform panel and the Rust contour set they measure.
 *
 * @remarks
 * Resize edits on ink bounds scale the skeleton about the opposite edge through
 * {@link import("@shift/types").FitInkBound | FitInkBound} until the ink edge lands.
 */
export interface TransformSelectionBounds {
  readonly bounds: LocalBounds;
  readonly measure: TransformBoundsMeasure;
  readonly layerId: LayerId;
  /** Empty when the whole layer (components included) is measured. */
  readonly contourIds: readonly ContourId[];
}
