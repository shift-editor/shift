import type {
  Point2D,
  PointId,
  ContourId,
  Point,
  Contour,
  Glyph,
  Rect2D,
  FontMetrics,
} from "@shift/types";
import type { Bounds } from "@shift/geo";
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
import type { Segment } from "@/types/segments";
import type { HitResult } from "@/types/hitResult";
import type { Modifiers } from "./GestureDetector";
import type {
  DragSnapSessionConfig,
  DragSnapSession,
  RotateSnapSession,
  SnapIndicator,
} from "@/lib/editor/snapping/types";

export interface ViewportContext {
  getMousePosition(): Point2D;
  getScreenMousePosition(): Point2D;
  flushMousePosition?(): void;
  projectScreenToUpm(x: number, y: number): Point2D;
  screenToUpmDistance(pixels: number): number;
  readonly hitRadius: number;
  readonly pan: Point2D;
  setPan(x: number, y: number): void;
}

export interface SelectionContext {
  getSelectedPoints(): PointId[];
  getSelectedSegments(): SegmentId[];
  hasSelection(): boolean;
  isPointSelected(id: PointId): boolean;
  isSegmentSelected(id: SegmentId): boolean;
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
}

export interface HitTestContext {
  getNodeAt(pos: Point2D): HitResult;
  getPointAt(pos: Point2D): Point | null;
  getSegmentAt(pos: Point2D): SegmentHitResult | null;
  getSegmentById(segmentId: SegmentId): Segment | null;
  getAllPoints(): Point[];
  getGlyph(): Glyph | null;
  getContourEndpointAt(pos: Point2D): ContourEndpointHit | null;
  getMiddlePointAt(pos: Point2D): MiddlePointHit | null;
  getSelectionBoundingRect(): Rect2D | null;
  hitTestBoundingBoxAt(pos: Point2D): BoundingBoxHitResult;
}

export interface SnappingContext {
  getSnapPreferences(): SnapPreferences;
  setSnapPreferences(next: Partial<SnapPreferences>): void;
  createDragSnapSession(config: DragSnapSessionConfig): DragSnapSession;
  createRotateSnapSession(): RotateSnapSession;
  setSnapIndicator(indicator: SnapIndicator | null): void;
}

export interface EditingContext {
  movePointTo(id: PointId, x: number, y: number): void;
  applySmartEdits(ids: readonly PointId[], dx: number, dy: number): PointId[];
  setPointPositions(moves: Array<{ id: PointId; x: number; y: number }>): void;
  toggleSmooth(id: PointId): void;
  duplicateSelection(): PointId[];
  getActiveContour(): Contour | null;
  getActiveContourId(): ContourId | null;
  clearActiveContour(): void;
  setActiveContour(id: ContourId): void;
}

export interface CommandContext {
  readonly commands: CommandHistory;
  beginPreview(): void;
  commitPreview(label: string): void;
  cancelPreview(): void;
}

export interface ToolLifecycleContext {
  readonly activeToolState: Signal<ActiveToolState>;
  getActiveToolState(): ActiveToolState;
  setActiveToolState(state: ActiveToolState): void;
  requestTemporaryTool(toolId: ToolName, options?: TemporaryToolOptions): void;
  returnFromTemporaryTool(): void;
  readonly currentModifiers: Signal<Modifiers>;
  getCurrentModifiers(): Modifiers;
  setCurrentModifiers?(modifiers: Modifiers): void;
  getFocusZone(): FocusZone;
}

export interface VisualStateContext {
  requestStaticRedraw(): void;
  requestRedraw(): void;
  updateHover(pos: Point2D): void;
  clearHover(): void;
  readonly hoveredBoundingBoxHandle: Signal<BoundingBoxHitResult>;
  getHoveredBoundingBoxHandle(): BoundingBoxHitResult;
  readonly hoveredPointId: Signal<PointId | null>;
  readonly hoveredSegmentId: Signal<SegmentIndicator | null>;
  readonly isHoveringNode: Signal<boolean>;
  getIsHoveringNode(): boolean;
  setHandlesVisible(visible: boolean): void;
  isPreviewMode(): boolean;
  setPreviewMode(enabled: boolean): void;
  setMarqueePreviewRect(rect: Rect2D | null): void;
  isPointInMarqueePreview(pointId: PointId): boolean;
}

export interface FontContext {
  getFontMetrics(): FontMetrics;
  getGlyphSvgPath(unicode: number): string | null;
  getGlyphAdvance(unicode: number): number | null;
  getGlyphBbox(unicode: number): Bounds | null;
}

export type ToolContext = ViewportContext &
  SelectionContext &
  HitTestContext &
  SnappingContext &
  EditingContext &
  CommandContext &
  ToolLifecycleContext &
  VisualStateContext &
  FontContext;
