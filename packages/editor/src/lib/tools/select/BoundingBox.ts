import { Bounds, Rect, Vec2, type Point2D, type Rect2D } from "@shift/geo";
import type { Editor } from "../../editor/Editor";
import type { Canvas, ScreenCanvas } from "../../editor/rendering/Canvas";
import { CanvasItem } from "../../editor/rendering/CanvasItem";
import type { Coordinates } from "../../../types/coordinates";
import { scenePoint } from "../../editor/spaces";
import type { CursorType } from "../../../types/editor";
import { edgeToCursor, type BoundingRectEdge } from "./cursor";
import type { Select } from "./Select";
import { track } from "../../signals/index";

export type CornerHandle = "top-left" | "top-right" | "bottom-left" | "bottom-right";

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
  readonly widthPx: number;
  readonly dashPx?: number[];
  readonly hitRadiusPx: number;
  readonly handle: {
    readonly radiusPx: number;
    readonly offsetPx: number;
    readonly widthPx: number;
  };
  readonly rotationZoneOffsetPx: number;
}

export const SELECT_BOUNDING_BOX_STYLE: SelectBoundingBoxStyle = {
  widthPx: 1,
  hitRadiusPx: 8,
  handle: {
    radiusPx: 4,
    offsetPx: 0,
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
  readonly sceneRect: Rect2D;
  readonly screenRect: Rect2D;
  /** Whether corner handles are drawn; hit zones exist either way. */
  readonly showHandles: boolean;
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
    if (state.type === "brushing" && !this.#editor.input.modifiersCell.value.shiftKey) return null;

    track(this.#editor.selection.stateCell);
    const ids =
      state.type === "brushing" ? state.selection.initialSelection : this.#editor.selection.ids;
    const selection = this.#editor.positionSelection(ids);
    let transformsWhole = false;
    if (selection) {
      const pointCount = selection.targets.points?.length ?? 0;
      const anchorCount = selection.targets.anchors?.length ?? 0;
      if (pointCount + anchorCount <= 1) return null;
    } else {
      if (!this.#editor.transformTarget(ids)) return null;
      transformsWhole = true;
    }

    const sceneBounds =
      state.type === "brushing"
        ? this.#editor.selectionSceneBounds(ids)
        : this.#editor.selectionSceneBoundsCell.value;
    if (!sceneBounds) return null;
    const sceneRect = Bounds.toRect(sceneBounds);

    this.#editor.camera.trackViewportTransform();

    const screenRect = this.#screenRect(sceneRect);
    if (!hasBoundingBoxArea(sceneRect)) return null;

    const screenHandles = getHandlePositions(
      screenRect,
      SELECT_BOUNDING_BOX_STYLE.handle.offsetPx,
      SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx,
    );

    return {
      sceneRect,
      screenRect,
      showHandles: transformsWhole,
      screenHandles,
      hitRadiusPx: SELECT_BOUNDING_BOX_STYLE.hitRadiusPx,
    };
  }

  get rect(): Rect2D | null {
    return this.propsSnapshot()?.sceneRect ?? null;
  }

  get screenRect(): Rect2D | null {
    return this.propsSnapshot()?.screenRect ?? null;
  }

  get visible(): boolean {
    return this.propsSnapshot() !== null;
  }

  hit(coords: Coordinates): BoundingBoxHitResult {
    if (this.#select.stateCell.peek().type === "brushing") return null;

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
        rect: props.sceneRect,
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
        rect: props.sceneRect,
        center: rectCenter(props.sceneRect),
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

  containsTranslationPoint(coords: Coordinates): boolean {
    const props = this.propsSnapshot();
    if (!props) return false;

    const { screenRect } = props;

    return Rect.containsPoint(screenRect, coords.screen);
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

    canvas.withScreenSpace((screen) => {
      this.#drawRect(screen, props.screenRect);
      if (props.showHandles) this.#drawHandles(screen, props.screenHandles);
    });
  }

  #screenRect(rect: Rect2D): Rect2D {
    return rectFromPoints(
      [
        scenePoint(rect.left, rect.top),
        scenePoint(rect.right, rect.top),
        scenePoint(rect.right, rect.bottom),
        scenePoint(rect.left, rect.bottom),
      ].map((point) => this.#editor.sceneToScreen(point)),
    );
  }

  #drawRect(canvas: ScreenCanvas, rect: Rect2D): void {
    const { widthPx, dashPx } = SELECT_BOUNDING_BOX_STYLE;
    const stroke = canvas.theme.segment.selectedColor;
    canvas.strokeRect(rect.x, rect.y, rect.width, rect.height, stroke, widthPx, dashPx);
  }

  #drawHandles(canvas: ScreenCanvas, handles: HandlePositions): void {
    const style = SELECT_BOUNDING_BOX_STYLE.handle;
    const fill = canvas.theme.handle.corner.idle.fill;
    const stroke = canvas.theme.segment.selectedColor;
    const cornerKeys = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

    for (const key of cornerKeys) drawHandle(canvas, handles.corners[key], style, fill, stroke);
  }
}

function getExpandedHandleRect(rect: Rect2D, offset: number): ExpandedHandleRect {
  return {
    left: rect.left - offset,
    right: rect.right + offset,
    top: rect.top - offset,
    bottom: rect.bottom + offset,
  };
}

export function getHandlePositions(
  rect: Rect2D,
  handleOffset: number,
  rotationZoneOffset: number,
): HandlePositions {
  const alignmentRect = getExpandedHandleRect(rect, handleOffset);
  const rotationRect = getExpandedHandleRect(rect, rotationZoneOffset);
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

function hasBoundingBoxArea(rect: Rect2D): boolean {
  return rect.width !== 0 && rect.height !== 0;
}

function rectFromPoints(points: readonly Point2D[]): Rect2D {
  const first = points[0];
  if (!first) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    };
  }

  let left = first.x;
  let right = first.x;
  let top = first.y;
  let bottom = first.y;

  for (const point of points.slice(1)) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }

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

function drawHandle(
  canvas: ScreenCanvas,
  center: Point2D,
  style: SelectBoundingBoxStyle["handle"],
  fill: string,
  stroke: string,
): void {
  canvas.ctx.save();

  const radius = style.radiusPx;
  const size = radius * 2;
  canvas.ctx.lineWidth = style.widthPx;
  canvas.ctx.fillStyle = fill;
  canvas.ctx.strokeStyle = stroke;
  canvas.ctx.fillRect(center.x - radius, center.y - radius, size, size);
  canvas.ctx.strokeRect(center.x - radius, center.y - radius, size, size);

  canvas.ctx.restore();
}

export function hitTestRotationZones(
  pos: Point2D,
  rotationZones: HandlePositions["rotationZones"],
  hitRadius: number,
): RawRotateHitResult {
  const corners: Array<[keyof HandlePositions["rotationZones"], CornerHandle]> = [
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
  return Vec2.midpoint({ x: rect.left, y: rect.top }, { x: rect.right, y: rect.bottom });
}

export function hitTestResize(
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
  const cornerChecks: Array<[keyof HandlePositions["corners"], Exclude<BoundingRectEdge, null>]> = [
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

function hitTestResizeEdges(rect: Rect2D, pos: Point2D, hitRadius: number): RawResizeHitResult {
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
