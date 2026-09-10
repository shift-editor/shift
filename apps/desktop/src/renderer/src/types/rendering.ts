import type { PointId } from "@shift/types";
import type { Point2D } from "@shift/geo";
import type { MarkerLayer } from "@/lib/graphics/backends/MarkerLayer";
import type { Canvas } from "@/lib/editor/rendering/Canvas";

/**
 * Names the editor paint phase requested from node definitions.
 *
 * @remarks
 * Render layers own pass ordering. Node definitions choose which phases they
 * paint in and ignore the rest.
 */
export type RenderPass = "background" | "content" | "controls" | "overlay";

declare global {
  interface WindowEventMap {
    "shift:geometry-submitted": CustomEvent<SubmittedGeometry | null>;
  }
}

/**
 * Exposes submitted marker coordinates during a synchronous E2E notification.
 *
 * @remarks
 * Borrows the uploaded instance buffer and its point identities. Neither this
 * view nor its methods may be retained after the notification returns. This
 * identifies draw input, not pixel correctness or display presentation.
 */
export interface SubmittedGeometry {
  /**
   * Reads a point's glyph-local coordinates from the uploaded marker instances.
   *
   * @param pointId - Authored identity to find in this submission.
   * @returns A coordinate copy, or null when the point was not submitted.
   */
  point(pointId: PointId): Point2D | null;
}

/**
 * Carries renderer-owned resources through one draw frame.
 *
 * @remarks
 * Render layers own z-order and pass sequencing. Node definitions and drawing
 * helpers receive this context so transient renderer resources, such as the
 * marker backend, do not become retained state outside the renderer.
 */
export interface RenderContext {
  /** Canvas configured for the layer currently being drawn. */
  readonly canvas: Canvas;

  /** Marker backend owned by the renderer for the current frame. */
  readonly markers: MarkerLayer;
}
