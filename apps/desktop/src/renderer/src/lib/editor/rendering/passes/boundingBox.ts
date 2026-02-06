import type { IRenderer } from "@/types/graphics";
import type { Rect2D } from "@shift/types";
import { BOUNDING_BOX_HANDLE_STYLES } from "@/lib/styles/style";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import { getHandlePositions, type HandlePositions } from "@/lib/tools/select/boundingBoxHitTest";
import type { RenderContext } from "./types";

export function renderBoundingRect(rc: RenderContext, rect: Rect2D): void {
  rc.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

export interface BoundingBoxHandlesOptions {
  rect: Rect2D;
  hoveredHandle?: BoundingBoxHitResult;
}

export function renderBoundingBoxHandles(ctx: IRenderer, options: BoundingBoxHandlesOptions): void {
  const { rect, hoveredHandle } = options;
  const styles = BOUNDING_BOX_HANDLE_STYLES;
  const handles = getHandlePositions(rect, styles.handle.offset, styles.rotationZoneOffset);

  drawHandles(ctx, handles, styles.handle.radius, hoveredHandle);
}

function drawHandles(
  ctx: IRenderer,
  handles: HandlePositions,
  radius: number,
  hoveredHandle?: BoundingBoxHitResult,
): void {
  const styles = BOUNDING_BOX_HANDLE_STYLES.handle;
  ctx.setStyle(styles);

  const cornerEdges = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
  const cornerKeys = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

  for (let i = 0; i < cornerKeys.length; i++) {
    const pos = handles.corners[cornerKeys[i]];
    const isHovered = hoveredHandle?.type === "resize" && hoveredHandle.edge === cornerEdges[i];
    const handleRadius = isHovered ? radius + 1 : radius;

    ctx.strokeCircle(pos.x, pos.y, handleRadius);
    ctx.fillCircle(pos.x, pos.y, handleRadius);
  }

  const midpointEdges = ["top", "bottom", "left", "right"] as const;
  const midpointKeys = ["top", "bottom", "left", "right"] as const;

  for (let i = 0; i < midpointKeys.length; i++) {
    const pos = handles.midpoints[midpointKeys[i]];
    const isHovered = hoveredHandle?.type === "resize" && hoveredHandle.edge === midpointEdges[i];
    const handleRadius = isHovered ? radius + 1 : radius;

    ctx.strokeCircle(pos.x, pos.y, handleRadius);
    ctx.fillCircle(pos.x, pos.y, handleRadius);
  }
}
