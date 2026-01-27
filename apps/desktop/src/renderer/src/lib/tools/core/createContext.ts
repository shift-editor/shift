import type {
  Point2D,
  Rect2D,
  PointId,
  ContourId,
  GlyphSnapshot,
  PointSnapshot,
  ContourSnapshot,
  PointType,
} from "@shift/types";
import { asContourId } from "@shift/types";
import type { CommandHistory } from "@/lib/commands";
import type { CursorType, SelectionMode } from "@/types/editor";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { ReflectAxis, SelectionBounds } from "@/lib/transform";
import type { SegmentHitResult } from "@/lib/geo/Segment";
import type { Segment } from "@/types/segments";
import type { Editor } from "@/lib/editor/Editor";
import { SCREEN_HIT_RADIUS } from "@/lib/editor/rendering/constants";

export interface ScreenService {
  toUpmDistance(pixels: number): number;
  readonly hitRadius: number;
  lineWidth(pixels?: number): number;
  projectScreenToUpm(x: number, y: number): Point2D;
  getMousePosition(x?: number, y?: number): Point2D;
}

export interface SelectionService {
  getSelectedPoints(): ReadonlySet<PointId>;
  getSelectedSegments(): ReadonlySet<SegmentId>;
  getMode(): SelectionMode;

  selectPoints(ids: Set<PointId>): void;
  addPoint(id: PointId): void;
  removePoint(id: PointId): void;
  togglePoint(id: PointId): void;
  isPointSelected(id: PointId): boolean;

  selectSegments(ids: Set<SegmentId>): void;
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
  getHoveredSegment(): SegmentIndicator | null;

  setHoveredPoint(id: PointId | null): void;
  setHoveredSegment(indicator: SegmentIndicator | null): void;
  clearAll(): void;
}

export interface PreviewService {
  beginPreview(): void;
  cancelPreview(): void;
  commitPreview(label: string): void;
  isInPreview(): boolean;
  getPreviewSnapshot(): GlyphSnapshot | null;
}

export interface EditService {
  getGlyph(): GlyphSnapshot | null;

  addPoint(x: number, y: number, type: PointType, smooth?: boolean): PointId;
  addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    type: PointType,
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
  clearActiveContour(): void;
  reverseContour(contourId: ContourId): void;
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
  getSelectionBounds(): SelectionBounds | null;
  getSelectionCenter(): Point2D | null;
}

export interface CursorService {
  getCursor(): string;
  set(cursor: CursorType): void;
}

export interface RenderService {
  requestRedraw(): void;
  requestImmediateRedraw(): void;
  cancelRedraw(): void;
  setPreviewMode(enabled: boolean): void;
}

export interface ViewportService {
  getZoom(): number;
  pan(dx: number, dy: number): void;
  getPan(): Point2D;
  zoomIn(): void;
  zoomOut(): void;
  zoomToPoint(screenX: number, screenY: number, zoomDelta: number): void;
}

export interface ContourEndpointHit {
  contourId: ContourId;
  pointId: PointId;
  position: "start" | "end";
  contour: ContourSnapshot;
}

export interface HitTestService {
  getPointAt(pos: Point2D): PointSnapshot | null;
  getPointIdAt(pos: Point2D): PointId | null;
  getSegmentAt(pos: Point2D): SegmentHitResult | null;
  getContourEndpointAt(pos: Point2D): ContourEndpointHit | null;
  getSelectionBoundingRect(): Rect2D | null;
  getAllPoints(): PointSnapshot[];
  findSegmentById(segmentId: SegmentId): Segment | null;
  updateHover(pos: Point2D): void;
}

export type ToolName = "select" | "pen" | "hand" | "shape" | "disabled";

export interface TemporaryToolOptions {
  onActivate?: () => void;
  onReturn?: () => void;
}

export interface ToolSwitchService {
  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void;
  returnFromTemporary(): void;
}

export interface ToolContext {
  readonly screen: ScreenService;
  readonly selection: SelectionService;
  readonly hover: HoverService;
  readonly edit: EditService;
  readonly preview: PreviewService;
  readonly transform: TransformService;
  readonly cursor: CursorService;
  readonly render: RenderService;
  readonly viewport: ViewportService;
  readonly hitTest: HitTestService;
  readonly commands: CommandHistory;
  tools: ToolSwitchService;
}

export function createContext(editor: Editor): ToolContext {
  const viewport = editor.viewportManager;
  const fontEngine = editor.fontEngine;
  const selection = editor.selectionManager;
  const hover = editor.hoverManager;
  const commands = editor.commandHistory;

  return {
    screen: {
      toUpmDistance: (px) => viewport.screenToUpmDistance(px),
      get hitRadius() {
        return viewport.screenToUpmDistance(SCREEN_HIT_RADIUS);
      },
      lineWidth: (px = 1) => viewport.screenToUpmDistance(px),
      projectScreenToUpm: (x, y) => viewport.projectScreenToUpm(x, y),
      getMousePosition: (x?, y?) => viewport.getMousePosition(x, y),
    },
    selection: {
      getSelectedPoints: () => selection.selectedPointIds.value,
      getSelectedSegments: () => selection.selectedSegmentIds.value,
      getMode: () => selection.selectionMode.value,
      selectPoints: (ids) => selection.selectPoints(ids),
      addPoint: (id) => selection.addPointToSelection(id),
      removePoint: (id) => selection.removePointFromSelection(id),
      togglePoint: (id) => selection.togglePointSelection(id),
      isPointSelected: (id) => selection.isPointSelected(id),
      selectSegments: (ids) => selection.selectSegments(ids),
      addSegment: (id) => selection.addSegmentToSelection(id),
      removeSegment: (id) => selection.removeSegmentFromSelection(id),
      toggleSegment: (id) => selection.toggleSegmentInSelection(id),
      isSegmentSelected: (id) => selection.isSegmentSelected(id),
      clear: () => selection.clearSelection(),
      hasSelection: () => selection.hasSelection(),
      setMode: (mode) => selection.setSelectionMode(mode),
    },
    hover: {
      getHoveredPoint: () => hover.hoveredPointId.value,
      getHoveredSegment: () => hover.hoveredSegmentId.value,
      setHoveredPoint: (id) => hover.setHoveredPoint(id),
      setHoveredSegment: (indicator) => hover.setHoveredSegment(indicator),
      clearAll: () => hover.clearHover(),
    },
    edit: {
      getGlyph: () => fontEngine.$glyph.value,
      addPoint: (x, y, type, smooth = false) =>
        fontEngine.editing.addPoint(x, y, type, smooth),
      addPointToContour: (contourId, x, y, type, smooth) =>
        fontEngine.editing.addPointToContour(contourId, x, y, type, smooth),
      movePoints: (ids, dx, dy) =>
        fontEngine.editing.movePoints([...ids], dx, dy),
      movePointTo: (id, x, y) => fontEngine.editing.movePointTo(id, x, y),
      applySmartEdits: (ids, dx, dy) =>
        fontEngine.editing.applySmartEdits(ids, dx, dy),
      removePoints: (ids) => fontEngine.editing.removePoints([...ids]),
      addContour: () => fontEngine.editing.addContour(),
      closeContour: () => fontEngine.editing.closeContour(),
      toggleSmooth: (id) => fontEngine.editing.toggleSmooth(id),
      getActiveContourId: () => {
        const id = fontEngine.editing.getActiveContourId();
        return id ? asContourId(id) : null;
      },
      setActiveContour: (contourId) =>
        fontEngine.editing.setActiveContour(contourId),
      clearActiveContour: () => fontEngine.editing.clearActiveContour(),
      reverseContour: (contourId) =>
        fontEngine.editing.reverseContour(contourId),
    },
    preview: {
      beginPreview: () => editor.beginPreview(),
      cancelPreview: () => editor.cancelPreview(),
      commitPreview: (label) => editor.commitPreview(label),
      isInPreview: () => editor.isInPreview,
      getPreviewSnapshot: () => editor.previewSnapshot,
    },
    transform: {
      rotate: (angle, origin?) => editor.rotateSelection(angle, origin),
      scale: (sx, sy?, origin?) => editor.scaleSelection(sx, sy ?? sx, origin),
      reflect: (axis, origin?) => editor.reflectSelection(axis, origin),
      rotate90CCW: () => editor.rotateSelection(Math.PI / 2),
      rotate90CW: () => editor.rotateSelection(-Math.PI / 2),
      rotate180: () => editor.rotateSelection(Math.PI),
      flipHorizontal: () => editor.reflectSelection("horizontal"),
      flipVertical: () => editor.reflectSelection("vertical"),
      getSelectionBounds: () => editor.getSelectionBounds(),
      getSelectionCenter: () => editor.getSelectionCenter(),
    },
    cursor: {
      getCursor: () => editor.cursor.value,
      set: (cursor) => editor.setCursor(cursor),
    },
    render: {
      requestRedraw: () => editor.requestRedraw(),
      requestImmediateRedraw: () => editor.requestImmediateRedraw(),
      cancelRedraw: () => editor.cancelRedraw(),
      setPreviewMode: (enabled) => editor.setPreviewMode(enabled),
    },
    viewport: {
      getZoom: () => viewport.zoom.value,
      pan: (dx, dy) => viewport.pan(dx, dy),
      getPan: () => ({ x: viewport.panX, y: viewport.panY }),
      zoomIn: () => viewport.zoomIn(),
      zoomOut: () => viewport.zoomOut(),
      zoomToPoint: (screenX, screenY, zoomDelta) =>
        viewport.zoomToPoint(screenX, screenY, zoomDelta),
    },
    hitTest: {
      getPointAt: (pos) => editor.getPointAt(pos),
      getPointIdAt: (pos) => editor.getPointIdAt(pos),
      getSegmentAt: (pos) => editor.getSegmentAt(pos),
      getContourEndpointAt: (pos) => editor.getContourEndpointAt(pos),
      getSelectionBoundingRect: () => editor.getSelectionBoundingRect(),
      getAllPoints: () => editor.getAllPoints(),
      findSegmentById: (id) => editor.findSegmentById(id),
      updateHover: (pos) => editor.updateHover(pos),
    },
    commands,
    tools: {
      requestTemporary: () => {},
      returnFromTemporary: () => {},
    },
  };
}
