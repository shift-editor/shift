import type { IRenderer } from "./graphics";
import type { GlyphSnapshot, PointId, ContourId, Point2D } from "@shift/types";
import type { CommandHistory } from "@/lib/commands";
import type { SelectionMode } from "./editor";
import type { SegmentIndicator } from "./indicator";
import type { ReflectAxis, SelectionBounds } from "@/lib/transform";

export type ToolName = "select" | "pen" | "hand" | "shape" | "disabled";

export interface ScreenContext {
  toUpmDistance(pixels: number): number;
  readonly hitRadius: number;
  lineWidth(pixels?: number): number;
}

export interface SelectContext {
  set(ids: Set<PointId>): void;
  add(id: PointId): void;
  remove(id: PointId): void;
  toggle(id: PointId): void;
  clear(): void;
  has(): boolean;
  setMode(mode: SelectionMode): void;
}

export interface IndicatorContext {
  setHoveredPoint(id: PointId | null): void;
  setHoveredSegment(indicator: SegmentIndicator | null): void;
  clearAll(): void;
}

export interface EditContext {
  addPoint(x: number, y: number, type: "onCurve" | "offCurve"): PointId;
  addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    type: string,
    smooth: boolean,
  ): PointId;
  movePoints(ids: Iterable<PointId>, dx: number, dy: number): void;
  movePointTo(id: PointId, x: number, y: number): void;
  applySmartEdits(ids: ReadonlySet<PointId>, dx: number, dy: number): PointId[];
  removePoints(ids: Iterable<PointId>): void;
  addContour(): ContourId;
  closeContour(): void;
  toggleSmooth(id: PointId): void;
  getActiveContourId(): ContourId | null;
  setActiveContour(contourId: ContourId): void;
  reverseContour(contourId: ContourId): void;
}

export interface TransformContext {
  /**
   * Rotate selected points.
   * @param angle - Rotation in radians (positive = counter-clockwise)
   * @param origin - Optional origin point; defaults to selection center
   */
  rotate(angle: number, origin?: Point2D): void;

  /**
   * Scale selected points.
   * @param sx - Scale factor X
   * @param sy - Scale factor Y (defaults to sx for uniform scale)
   * @param origin - Optional origin; defaults to selection center
   */
  scale(sx: number, sy?: number, origin?: Point2D): void;

  /**
   * Reflect (mirror) selected points across an axis.
   * @param axis - 'horizontal' | 'vertical' | { angle: number }
   * @param origin - Optional origin; defaults to selection center
   */
  reflect(axis: ReflectAxis, origin?: Point2D): void;

  /**
   * Rotate 90° counter-clockwise.
   */
  rotate90CCW(): void;

  /**
   * Rotate 90° clockwise.
   */
  rotate90CW(): void;

  /**
   * Rotate 180°.
   */
  rotate180(): void;

  /**
   * Flip horizontally (mirror across horizontal axis).
   */
  flipHorizontal(): void;

  /**
   * Flip vertically (mirror across vertical axis).
   */
  flipVertical(): void;

  /**
   * Get the bounding box and center of the current selection.
   * Returns null if no points are selected.
   */
  getSelectionBounds(): SelectionBounds | null;

  /**
   * Get the center of the current selection's bounding box.
   * Returns null if no points are selected.
   */
  getSelectionCenter(): Point2D | null;
}

export interface ToolContext {
  readonly snapshot: GlyphSnapshot | null;
  readonly selectedPoints: ReadonlySet<PointId>;
  readonly hoveredPoint: PointId | null;
  readonly hoveredSegment: SegmentIndicator | null;
  readonly mousePosition: Point2D;
  readonly selectionMode: SelectionMode;

  readonly screen: ScreenContext;
  readonly select: SelectContext;
  readonly indicators: IndicatorContext;
  readonly edit: EditContext;
  readonly transform: TransformContext;

  readonly commands: CommandHistory;
  requestRedraw(): void;
}

export interface Tool {
  name: ToolName;

  setIdle(): void;
  setReady(): void;

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;

  keyDownHandler?(e: KeyboardEvent): void;
  keyUpHandler?(e: KeyboardEvent): void;
  onDoubleClick?(e: React.MouseEvent<HTMLCanvasElement>): void;

  drawInteractive?(ctx: IRenderer): void;

  dispose?(): void;

  cancel?(): void;
}
