import type { IRenderer } from "@/types/graphics";

/**
 * Shared context passed to render passes that operate in UPM space.
 *
 * `lineWidthUpm` converts a screen-pixel width into UPM units so that
 * strokes appear at a consistent visual thickness regardless of zoom.
 */
export interface RenderContext {
  ctx: IRenderer;
  lineWidthUpm: (screenPx?: number) => number;
}
