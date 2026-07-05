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
