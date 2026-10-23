import type { MarkerLayer } from "../lib/graphics/backends/MarkerLayer";
import type { Canvas } from "../lib/editor/rendering/Canvas";
import type { EditorRenderTheme } from "../lib/editor/rendering/Theme";

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

/**
 * The rectangles one node added to the content pass's shared fill, in scene units.
 *
 * @remarks
 * Valid while the node's visible entry, the zoom, and the theme it was
 * recorded at stay the same.
 */
export interface RecordedFill {
  readonly zoom: number;
  readonly theme: EditorRenderTheme;
  /** False when the node draws itself instead of filling rectangles. */
  readonly filled: boolean;
  /** Each rectangle's color, in order. */
  readonly colors: readonly string[];
  /** Each rectangle as `x, y, width, height`, in order. */
  readonly rects: readonly number[];
}
