import type { IRenderer } from "@/types/graphics";
import type { DrawStyle } from "@/lib/styles/style";

/**
 * Shared context passed to render passes that operate in UPM space.
 *
 * `pxToUpm` converts a screen-pixel width into UPM units so that
 * strokes appear at a consistent visual thickness regardless of zoom.
 */
export interface RenderContext {
  ctx: IRenderer;
  pxToUpm: (screenPx?: number) => number;
  applyStyle: (style: DrawStyle) => void;
}
