import type { Point2D, PointId, ContourId, Point, Contour, Glyph, Rect2D } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { SelectionMode, SnapPreferences } from "@/types/editor";
import type { ContourEndpointHit, MiddlePointHit } from "@/types/hitResult";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { FocusZone } from "@/types/focus";
import type { ToolName } from "./createContext";
import type { ActiveToolState } from "./ToolStateMap";
import type { TemporaryToolOptions } from "@/types/editor";
import type { CommandHistory } from "@/lib/commands";
import type { Signal } from "@/lib/reactive/signal";
import type { SegmentHitResult } from "@/lib/geo/Segment";
import type { FontEngine } from "@/engine";
import type { Segment } from "@/types/segments";
import type { HitResult } from "@/types/hitResult";
import type { Modifiers } from "./GestureDetector";
import type {
  DragSnapSessionConfig,
  DragSnapSession,
  RotateSnapSession,
  SnapIndicator,
} from "@/lib/editor/snapping/types";

export interface ToolContext {
  readonly activeToolState: Signal<ActiveToolState>;
  getActiveToolState(): ActiveToolState;
  setActiveToolState(state: ActiveToolState): void;
  getMousePosition(): Point2D;
  getScreenMousePosition(): Point2D;
  /** Called by ToolManager on pointer frame flush; not part of the tool API. */
  flushMousePosition?(): void;
  projectScreenToUpm(x: number, y: number): Point2D;
  requestStaticRedraw(): void;
  updateHover(pos: Point2D): void;
  readonly commands: CommandHistory;
  beginPreview(): void;
  commitPreview(label: string): void;
  cancelPreview(): void;
  getNodeAt(pos: Point2D): HitResult;
  getPointAt(pos: Point2D): Point | null;
  getSegmentAt(pos: Point2D): SegmentHitResult | null;
  getSegmentById(segmentId: SegmentId): Segment | null;
  getAllPoints(): Point[];
  getGlyph(): Glyph | null;
  getContourEndpointAt(pos: Point2D): ContourEndpointHit | null;
  getMiddlePointAt(pos: Point2D): MiddlePointHit | null;
  getSelectedPoints(): PointId[];
  getSelectedSegments(): SegmentId[];
  hasSelection(): boolean;
  isPointSelected(id: PointId): boolean;
  isSegmentSelected(id: SegmentId): boolean;
  getSelectedPointsCount(): number;
  getSelectedSegmentsCount(): number;
  selectPoints(ids: readonly PointId[]): void;
  clearSelection(): void;
  setSelectionMode(mode: SelectionMode): void;
  addPointToSelection(id: PointId): void;
  removePointFromSelection(id: PointId): void;
  togglePointSelection(id: PointId): void;
  selectSegments(ids: readonly SegmentId[]): void;
  addSegmentToSelection(id: SegmentId): void;
  removeSegmentFromSelection(id: SegmentId): void;
  toggleSegmentInSelection(id: SegmentId): void;
  movePointTo(id: PointId, x: number, y: number): void;
  applySmartEdits(ids: readonly PointId[], dx: number, dy: number): PointId[];
  setPointPositions(moves: Array<{ id: PointId; x: number; y: number }>): void;
  toggleSmooth(id: PointId): void;
  getSelectionBoundingRect(): Rect2D | null;
  screenToUpmDistance(pixels: number): number;
  readonly hitRadius: number;
  clearHover(): void;
  setHandlesVisible(visible: boolean): void;
  readonly pan: Point2D;
  setPan(x: number, y: number): void;
  requestTemporaryTool(toolId: ToolName, options?: TemporaryToolOptions): void;
  returnFromTemporaryTool(): void;
  readonly hoveredBoundingBoxHandle: Signal<BoundingBoxHitResult>;
  getHoveredBoundingBoxHandle(): BoundingBoxHitResult;
  readonly hoveredPointId: Signal<PointId | null>;
  readonly hoveredSegmentId: Signal<SegmentIndicator | null>;
  /** True when the pointer is over a point or segment (outline node). */
  readonly isHoveringNode: Signal<boolean>;
  getIsHoveringNode(): boolean;
  readonly currentModifiers: Signal<Modifiers>;
  getCurrentModifiers(): Modifiers;
  setCurrentModifiers?(modifiers: Modifiers): void;
  getSnapPreferences(): SnapPreferences;
  setSnapPreferences(next: Partial<SnapPreferences>): void;
  createDragSnapSession(config: DragSnapSessionConfig): DragSnapSession;
  createRotateSnapSession(): RotateSnapSession;
  setSnapIndicator(indicator: SnapIndicator | null): void;
  setPreviewMode(enabled: boolean): void;
  setMarqueePreviewRect(rect: Rect2D | null): void;
  isPointInMarqueePreview(pointId: PointId): boolean;
  getFocusZone(): FocusZone;
  getActiveContour(): Contour | null;
  getActiveContourId(): ContourId | null;
  clearActiveContour(): void;
  setActiveContour(id: ContourId): void;
  requestRedraw(): void;
  readonly fontEngine?: FontEngine;
}
