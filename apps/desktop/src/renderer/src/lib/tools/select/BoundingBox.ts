import { Bounds, Vec2, type Point2D, type Rect2D } from "@shift/geo";
import type { Editor } from "@/lib/editor/Editor";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { CanvasItem } from "@/lib/editor/rendering/CanvasItem";
import type { Coordinates } from "@/types/coordinates";
import type { CursorType } from "@/types/editor";
import { edgeToCursor, type BoundingRectEdge } from "./cursor";
import type { Select } from "./Select";

type YAxisDirection = "up" | "down";

export type CornerHandle =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type BoundingBoxHitResult =
  | {
      type: "resize";
      edge: Exclude<BoundingRectEdge, null>;
      rect: Rect2D;
      cursor: CursorType;
    }
  | {
      type: "rotate";
      corner: CornerHandle;
      rect: Rect2D;
      center: Point2D;
      cursor: CursorType;
    }
  | null;

type RawResizeHitResult = {
  type: "resize";
  edge: Exclude<BoundingRectEdge, null>;
} | null;
type RawRotateHitResult = { type: "rotate"; corner: CornerHandle } | null;

interface SelectBoundingBoxStyle {
  readonly stroke: string;
  readonly widthPx: number;
  readonly dashPx?: number[];
  readonly hitRadiusPx: number;
  readonly handle: {
    readonly radiusPx: number;
    readonly offsetPx: number;
    readonly fill: string;
    readonly stroke: string;
    readonly widthPx: number;
  };
  readonly rotationZoneOffsetPx: number;
}

export const SELECT_BOUNDING_BOX_STYLE: SelectBoundingBoxStyle = {
  stroke: "#1886D7",
  widthPx: 1,
  hitRadiusPx: 8,
  handle: {
    radiusPx: 4,
    offsetPx: 0,
    fill: "#ffffff",
    stroke: "#1886D7",
    widthPx: 1.25,
  },
  rotationZoneOffsetPx: 8,
};

interface HandlePositions {
  corners: {
    topLeft: Point2D;
    topRight: Point2D;
    bottomLeft: Point2D;
    bottomRight: Point2D;
  };
  midpoints: {
    top: Point2D;
    bottom: Point2D;
    left: Point2D;
    right: Point2D;
  };
  rotationZones: {
    topLeft: Point2D;
    topRight: Point2D;
    bottomLeft: Point2D;
    bottomRight: Point2D;
  };
}

interface ExpandedHandleRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface SelectBoundingBoxProps {
  readonly rect: Rect2D;
  readonly screenRect: Rect2D;
  readonly upmHandles: HandlePositions;
  readonly screenHandles: HandlePositions;
  readonly hitRadiusPx: number;
}

export class SelectBoundingBox extends CanvasItem<SelectBoundingBoxProps> {
  readonly #select: Select;
  readonly #editor: Editor;

  constructor(select: Select) {
    super();
    this.#select = select;
    this.#editor = select.editor;
  }

  protected props(): SelectBoundingBoxProps | null {
    const state = this.#select.stateCell.value;
    if (state.type === "brushing") return null;

    const display = this.#editor.glyphDisplayCell.value;
    if (
      !display.handlesVisible ||
      display.proofMode ||
      !display.editableGlyphVisible
    )
      return null;

    const selection = this.#editor.selection.stateCell.value;
    const selectedCount =
      selection.pointIds.size +
      selection.anchorIds.size +
      selection.segmentIds.size;
    if (selectedCount <= 1) return null;

    const bounds = this.#editor.selection.boundsCell.value;
    if (!bounds) return null;

    this.#editor.camera.trackViewportTransform();

    const rect = Bounds.toRect(bounds);
    const screenRect = this.#screenRect(rect);
    const upmHandles = getHandlePositions(
      rect,
      this.#editor.screenToUpmDistance(
        SELECT_BOUNDING_BOX_STYLE.handle.offsetPx,
      ),
      this.#editor.screenToUpmDistance(
        SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx,
      ),
    );
    const screenHandles = getHandlePositions(
      screenRect,
      SELECT_BOUNDING_BOX_STYLE.handle.offsetPx,
      SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx,
      "down",
    );

    return {
      rect,
      screenRect,
      upmHandles,
      screenHandles,
      hitRadiusPx: SELECT_BOUNDING_BOX_STYLE.hitRadiusPx,
    };
  }

  get rect(): Rect2D | null {
    return this.propsSnapshot()?.rect ?? null;
  }

  get screenRect(): Rect2D | null {
    return this.propsSnapshot()?.screenRect ?? null;
  }

  get visible(): boolean {
    return this.propsSnapshot() !== null;
  }

  hit(coords: Coordinates): BoundingBoxHitResult {
    const props = this.propsSnapshot();
    if (!props) return null;

    const pos = coords.screen;

    const resizeResult = hitTestResize(
      props.screenRect,
      pos,
      props.screenHandles,
      props.hitRadiusPx,
    );

    if (resizeResult) {
      return {
        type: resizeResult.type,
        edge: resizeResult.edge,
        rect: props.rect,
        cursor: edgeToCursor(resizeResult.edge),
      };
    }

    const rotationResult = hitTestRotationZones(
      pos,
      props.screenHandles.rotationZones,
      props.hitRadiusPx,
    );

    if (rotationResult) {
      return {
        type: rotationResult.type,
        corner: rotationResult.corner,
        rect: props.rect,
        center: rectCenter(props.rect),
        cursor: this.cursorForRotationCorner(rotationResult.corner),
      };
    }

    return null;
  }

  cursor(coords: Coordinates): CursorType | null {
    const hit = this.hit(coords);
    if (!hit) return null;

    return hit.cursor;
  }

  cursorForRotationCorner(corner: CornerHandle): CursorType {
    switch (corner) {
      case "top-left":
        return { type: "rotate-tl" };
      case "top-right":
        return { type: "rotate-tr" };
      case "bottom-left":
        return { type: "rotate-bl" };
      case "bottom-right":
        return { type: "rotate-br" };
    }
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    this.#drawRect(canvas, props.rect);
    this.#drawHandles(canvas, props.upmHandles);
  }

  #screenRect(rect: Rect2D): Rect2D {
    const topLeft = this.#editor.fromGlyphLocal({
      x: rect.left,
      y: rect.bottom,
    }).screen;
    const bottomRight = this.#editor.fromGlyphLocal({
      x: rect.right,
      y: rect.top,
    }).screen;

    const left = Math.min(topLeft.x, bottomRight.x);
    const right = Math.max(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    const bottom = Math.max(topLeft.y, bottomRight.y);

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      left,
      top,
      right,
      bottom,
    };
  }

  #drawRect(canvas: Canvas, rect: Rect2D): void {
    const { stroke, widthPx, dashPx } = SELECT_BOUNDING_BOX_STYLE;
    canvas.strokeRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      stroke,
      widthPx,
      dashPx,
    );
  }

  #drawHandles(canvas: Canvas, handles: HandlePositions): void {
    const styles = SELECT_BOUNDING_BOX_STYLE;

    const cornerKeys = [
      "topLeft",
      "topRight",
      "bottomLeft",
      "bottomRight",
    ] as const;
    for (const key of cornerKeys) {
      drawHandle(canvas, handles.corners[key], styles.handle);
    }
  }
}

function drawHandle(
  canvas: Canvas,
  center: Point2D,
  style: SelectBoundingBoxStyle["handle"],
): void {
  canvas.ctx.save();

  const radius = canvas.pxToUpm(style.radiusPx);
  const size = radius * 2;
  const half = radius;

  canvas.ctx.lineWidth = canvas.pxToUpm(style.widthPx);
  canvas.ctx.fillStyle = style.fill;
  canvas.ctx.strokeStyle = style.stroke;
  canvas.ctx.fillRect(center.x - half, center.y - half, size, size);
  canvas.ctx.strokeRect(center.x - half, center.y - half, size, size);

  canvas.ctx.restore();
}

function getExpandedHandleRect(
  rect: Rect2D,
  offset: number,
  yAxisDirection: YAxisDirection,
): ExpandedHandleRect {
  const left = rect.left - offset;
  const right = rect.right + offset;

  if (yAxisDirection === "up") {
    return {
      left,
      right,
      top: rect.bottom + offset,
      bottom: rect.top - offset,
    };
  }

  return {
    left,
    right,
    top: rect.top - offset,
    bottom: rect.bottom + offset,
  };
}

function getHandlePositions(
  rect: Rect2D,
  handleOffset: number,
  rotationZoneOffset: number,
  yAxisDirection: YAxisDirection = "up",
): HandlePositions {
  const alignmentRect = getExpandedHandleRect(
    rect,
    handleOffset,
    yAxisDirection,
  );
  const rotationRect = getExpandedHandleRect(
    rect,
    rotationZoneOffset,
    yAxisDirection,
  );
  const centerX = (alignmentRect.left + alignmentRect.right) / 2;
  const centerY = (alignmentRect.top + alignmentRect.bottom) / 2;

  return {
    corners: {
      topLeft: {
        x: alignmentRect.left,
        y: alignmentRect.top,
      },
      topRight: {
        x: alignmentRect.right,
        y: alignmentRect.top,
      },
      bottomLeft: {
        x: alignmentRect.left,
        y: alignmentRect.bottom,
      },
      bottomRight: {
        x: alignmentRect.right,
        y: alignmentRect.bottom,
      },
    },
    midpoints: {
      top: { x: centerX, y: alignmentRect.top },
      bottom: {
        x: centerX,
        y: alignmentRect.bottom,
      },
      left: { x: alignmentRect.left, y: centerY },
      right: { x: alignmentRect.right, y: centerY },
    },
    rotationZones: {
      topLeft: {
        x: rotationRect.left,
        y: rotationRect.top,
      },
      topRight: {
        x: rotationRect.right,
        y: rotationRect.top,
      },
      bottomLeft: {
        x: rotationRect.left,
        y: rotationRect.bottom,
      },
      bottomRight: {
        x: rotationRect.right,
        y: rotationRect.bottom,
      },
    },
  };
}

function hitTestRotationZones(
  pos: Point2D,
  rotationZones: HandlePositions["rotationZones"],
  hitRadius: number,
): RawRotateHitResult {
  const corners: Array<[keyof HandlePositions["rotationZones"], CornerHandle]> =
    [
      ["topLeft", "top-left"],
      ["topRight", "top-right"],
      ["bottomLeft", "bottom-left"],
      ["bottomRight", "bottom-right"],
    ];

  for (const [key, corner] of corners) {
    if (Vec2.dist(pos, rotationZones[key]) < hitRadius) {
      return { type: "rotate", corner };
    }
  }

  return null;
}

function rectCenter(rect: Rect2D): Point2D {
  return Vec2.midpoint(
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.bottom },
  );
}

function hitTestResize(
  rect: Rect2D,
  pos: Point2D,
  handles: HandlePositions,
  hitRadius: number,
): RawResizeHitResult {
  const cornerHit = hitTestResizeHandles(pos, handles, hitRadius);
  if (cornerHit) return cornerHit;

  return hitTestResizeEdges(rect, pos, hitRadius);
}

function hitTestResizeHandles(
  pos: Point2D,
  handles: HandlePositions,
  hitRadius: number,
): RawResizeHitResult {
  const cornerChecks: Array<
    [keyof HandlePositions["corners"], Exclude<BoundingRectEdge, null>]
  > = [
    ["topLeft", "top-left"],
    ["topRight", "top-right"],
    ["bottomLeft", "bottom-left"],
    ["bottomRight", "bottom-right"],
  ];

  for (const [key, edge] of cornerChecks) {
    if (Vec2.dist(pos, handles.corners[key]) < hitRadius) {
      return { type: "resize", edge };
    }
  }

  const midpointChecks: Array<
    [keyof HandlePositions["midpoints"], Exclude<BoundingRectEdge, null>]
  > = [
    ["top", "top"],
    ["bottom", "bottom"],
    ["left", "left"],
    ["right", "right"],
  ];

  for (const [key, edge] of midpointChecks) {
    if (Vec2.dist(pos, handles.midpoints[key]) < hitRadius) {
      return { type: "resize", edge };
    }
  }

  return null;
}

function hitTestResizeEdges(
  rect: Rect2D,
  pos: Point2D,
  hitRadius: number,
): RawResizeHitResult {
  const withinX = pos.x >= rect.left && pos.x <= rect.right;
  const withinY = pos.y >= rect.top && pos.y <= rect.bottom;

  if (withinX && Math.abs(pos.y - rect.top) <= hitRadius) {
    return { type: "resize", edge: "top" };
  }

  if (withinX && Math.abs(pos.y - rect.bottom) <= hitRadius) {
    return { type: "resize", edge: "bottom" };
  }

  if (withinY && Math.abs(pos.x - rect.left) <= hitRadius) {
    return { type: "resize", edge: "left" };
  }

  if (withinY && Math.abs(pos.x - rect.right) <= hitRadius) {
    return { type: "resize", edge: "right" };
  }

  return null;
}
