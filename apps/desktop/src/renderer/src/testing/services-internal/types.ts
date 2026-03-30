import type {
  PointId,
  ContourId,
  GlyphSnapshot,
  Point,
  Contour,
  AnchorId,
  PointType,
} from "@shift/types";
import type { InteractionSession } from "@/lib/tools/core";
import type { SelectionMode, CursorType, TemporaryToolOptions } from "@/types/editor";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { Point2D, Rect2D } from "@shift/types";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { Coordinates } from "@/types/coordinates";
import type { NodePositionUpdateList } from "@/types/positionUpdate";
import type { ReflectAxis } from "@/types/transform";
import type { SegmentHitResult } from "@/lib/geo/Segments";
import type { ToolName } from "@/lib/tools/core";
import type { ContourEndpointHit, HitResult } from "@/types/hitResult";
import type { Signal } from "@/lib/reactive/signal";

export interface ScreenService {
  toUpmDistance(pixels: number): number;
  readonly hitRadius: number;
  lineWidth(pixels?: number): number;
  projectScreenToScene(screen: Point2D): Point2D;
  projectSceneToScreen(scene: Point2D): Point2D;
  getMousePosition(x?: number, y?: number): Point2D;
}

export interface SelectionService {
  getSelectedPoints(): readonly PointId[];
  getSelectedAnchors(): readonly AnchorId[];
  getSelectedSegments(): readonly SegmentId[];
  getSelectedPointsCount(): number;
  getSelectedAnchorsCount(): number;
  getSelectedSegmentsCount(): number;
  getMode(): SelectionMode;
  selectPoints(ids: readonly PointId[]): void;
  selectAnchors(ids: readonly AnchorId[]): void;
  addPoint(id: PointId): void;
  addAnchor(id: AnchorId): void;
  removePoint(id: PointId): void;
  removeAnchor(id: AnchorId): void;
  togglePoint(id: PointId): void;
  toggleAnchor(id: AnchorId): void;
  isPointSelected(id: PointId): boolean;
  isAnchorSelected(id: AnchorId): boolean;
  selectSegments(ids: readonly SegmentId[]): void;
  addSegment(id: SegmentId): void;
  removeSegment(id: SegmentId): void;
  toggleSegment(id: SegmentId): void;
  isSegmentSelected(id: SegmentId): boolean;
  clear(): void;
  hasSelection(): boolean;
  setMode(mode: SelectionMode): void;
}

export interface HoverService {
  getHoveredPoint(): PointId | null;
  getHoveredAnchor(): AnchorId | null;
  getHoveredSegment(): SegmentIndicator | null;
  getHoveredBoundingBoxHandle(): BoundingBoxHitResult;
  readonly hoveredPointId: Signal<PointId | null>;
  readonly hoveredAnchorId: Signal<AnchorId | null>;
  readonly hoveredSegmentId: Signal<SegmentIndicator | null>;
  setHoveredPoint(id: PointId | null): void;
  setHoveredAnchor(id: AnchorId | null): void;
  setHoveredSegment(indicator: SegmentIndicator | null): void;
  setHoveredBoundingBoxHandle(handle: BoundingBoxHitResult): void;
  clearAll(): void;
}

export interface EditService {
  getGlyph(): GlyphSnapshot | null;
  getPointById(id: PointId): Point | null;
  getContourById(id: ContourId): Contour | null;
  getActiveContour(): Contour | null;
  addPoint(x: number, y: number, type: PointType, smooth?: boolean): PointId;
  addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    type: PointType,
    smooth: boolean,
  ): PointId;
  insertPointBefore(
    beforePointId: PointId,
    x: number,
    y: number,
    type: PointType,
    smooth: boolean,
  ): PointId;
  movePoints(ids: Iterable<PointId>, dx: number, dy: number): void;
  movePointTo(id: PointId, x: number, y: number): void;
  setNodePositions(updates: NodePositionUpdateList): void;
  beginInteractionSession(label: string): InteractionSession;
  moveAnchors(ids: AnchorId[], dx: number, dy: number): void;
  applySmartEdits(ids: readonly PointId[], dx: number, dy: number): PointId[];
  removePoints(ids: Iterable<PointId>): void;
  addContour(): ContourId;
  closeContour(): void;
  toggleSmooth(id: PointId): void;
  getActiveContourId(): ContourId | null;
  setActiveContour(contourId: ContourId): void;
  clearActiveContour(): void;
  reverseContour(contourId: ContourId): void;
}

export interface PreviewService {
  beginPreview(): void;
  cancelPreview(): void;
  resetPreviewToStart(): void;
  commitPreview(label: string): void;
  isInPreview(): boolean;
  getPreviewSnapshot(): GlyphSnapshot | null;
}

export interface TransformService {
  rotate(angle: number, origin?: Point2D): void;
  scale(sx: number, sy?: number, origin?: Point2D): void;
  reflect(axis: ReflectAxis, origin?: Point2D): void;
  rotate90CCW(): void;
  rotate90CW(): void;
  rotate180(): void;
  flipHorizontal(): void;
  flipVertical(): void;
  getSelectionBounds(): Rect2D | null;
  getSelectionCenter(): Point2D | null;
}

export interface CursorService {
  get(): string;
  set(cursor: CursorType): void;
}

export interface RenderService {
  requestRedraw(): void;
  requestStaticRedraw(): void;
  requestImmediateRedraw(): void;
  cancelRedraw(): void;
  isPreviewMode(): boolean;
  setPreviewMode(enabled: boolean): void;
  setHandlesVisible(visible: boolean): void;
}

export interface ViewportService {
  getZoom(): number;
  pan(dx: number, dy: number): void;
  getPan(): Point2D;
  zoomIn(): void;
  zoomOut(): void;
  zoomToPoint(screenX: number, screenY: number, zoomDelta: number): void;
}

export interface HitTestService {
  getNodeAt(coords: Coordinates): HitResult;
  getAnchorAt(
    coords: Coordinates,
  ): { id: AnchorId; name: string | null; x: number; y: number } | null;
  getPointAt(coords: Coordinates): Point | null;
  getSegmentAt(coords: Coordinates): SegmentHitResult | null;
  getContourEndpointAt(coords: Coordinates): ContourEndpointHit | null;
  getSelectionBoundingRect(): Rect2D | null;
  getAllPoints(): Point[];
  getSegmentById(segmentId: SegmentId): SegmentHitResult["segment"] | null;
  updateHover(coords: Coordinates): void;
  getMiddlePointAt(coords: Coordinates): Extract<HitResult, { type: "middlePoint" }> | null;
}

export interface ToolSwitchService {
  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void;
  returnFromTemporary(): void;
}
