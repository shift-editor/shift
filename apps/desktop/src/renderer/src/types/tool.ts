import type { IRenderer } from "./graphics";
import type { GlyphSnapshot } from "./generated";
import type { PointId, ContourId } from "./ids";
import type { Point2D } from "./math";
import type { CommandHistory } from "@/lib/commands";
import type { SelectionMode } from "@/lib/editor/SelectionManager";
import type { SegmentIndicator } from "./indicator";

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
  movePoints(ids: Iterable<PointId>, dx: number, dy: number): void;
  movePointTo(id: PointId, x: number, y: number): void;
  applySmartEdits(ids: ReadonlySet<PointId>, dx: number, dy: number): PointId[];
  removePoints(ids: Iterable<PointId>): void;
  addContour(): ContourId;
  closeContour(): void;
  toggleSmooth(id: PointId): void;
  getActiveContourId(): ContourId | null;
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
}
