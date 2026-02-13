/**
 * Bounding-box render pass -- draws the selection bounding rectangle and its
 * resize/rotate handles.
 *
 * The bounding rectangle itself is drawn in UPM space (via {@link RenderContext}).
 * The corner and midpoint handles are drawn in screen space by
 * {@link renderBoundingBoxHandles} so they remain a fixed pixel size regardless
 * of zoom level.
 */

import type { IRenderer } from "@/types/graphics";
import type { Rect2D } from "@shift/types";
import { BOUNDING_BOX_HANDLE_STYLES } from "@/lib/styles/style";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import { getHandlePositions, type HandlePositions } from "@/lib/tools/select/boundingBoxHitTest";
import type { RenderContext } from "./types";

/** Strokes the selection bounding rectangle in UPM space. */
export function renderBoundingRect(rc: RenderContext, rect: Rect2D): void {
  rc.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

export interface BoundingBoxHandlesOptions {
  /** Bounding rectangle in screen pixels (already projected from UPM). */
  rect: Rect2D;
  /** Current hover hit result (kept for API parity with other handle renderers). */
  hoveredHandle?: BoundingBoxHitResult;
}

/**
 * Draws corner and midpoint resize handles in screen space.
 */
export function renderBoundingBoxHandles(ctx: IRenderer, options: BoundingBoxHandlesOptions): void {
  const { rect, hoveredHandle } = options;
  const styles = BOUNDING_BOX_HANDLE_STYLES;
  const handles = getHandlePositions(rect, styles.handle.offset, styles.rotationZoneOffset, "down");

  drawHandles(ctx, handles, styles.handle.radius, hoveredHandle);
}

function drawHandles(
  ctx: IRenderer,
  handles: HandlePositions,
  radius: number,
  _hoveredHandle?: BoundingBoxHitResult,
): void {
  const styles = BOUNDING_BOX_HANDLE_STYLES.handle;
  ctx.setStyle(styles);

  const cornerKeys = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

  for (let i = 0; i < cornerKeys.length; i++) {
    const pos = handles.corners[cornerKeys[i]];

    ctx.strokeCircle(pos.x, pos.y, radius);
    ctx.fillCircle(pos.x, pos.y, radius);
  }

  const midpointKeys = ["top", "bottom", "left", "right"] as const;

  for (let i = 0; i < midpointKeys.length; i++) {
    const pos = handles.midpoints[midpointKeys[i]];

    ctx.strokeCircle(pos.x, pos.y, radius);
    ctx.fillCircle(pos.x, pos.y, radius);
  }
}
