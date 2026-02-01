import { vi } from "vitest";
import type { PointId, ContourId, GlyphSnapshot, Point, Contour } from "@shift/types";
import { asContourId, asPointId } from "@shift/types";
import type { ToolName } from "@/lib/tools/core";
import type { ContourEndpointHit, TemporaryToolOptions } from "@/lib/editor/services";
import type { CommandHistory } from "@/lib/commands";
import type { SelectionMode, CursorType } from "@/types/editor";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { Point2D } from "@shift/types";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import type { BoundingBoxHitResult } from "@/types/boundingBox";

export interface ToolMouseEvent {
  readonly screen: Point2D;
  readonly upm: Point2D;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly button: number;
}
import { FontEngine, MockFontEngine } from "@/engine";
import { Segment as SegmentOps, type SegmentHitResult } from "@/lib/geo/Segment";

interface ScreenService {
  toUpmDistance(pixels: number): number;
  readonly hitRadius: number;
  lineWidth(pixels?: number): number;
  projectScreenToUpm(x: number, y: number): Point2D;
  getMousePosition(x?: number, y?: number): Point2D;
}

interface SelectionService {
  getSelectedPoints(): readonly PointId[];
  getSelectedSegments(): readonly SegmentId[];
  getSelectedPointsCount(): number;
  getSelectedSegmentsCount(): number;
  getMode(): SelectionMode;
  selectPoints(ids: readonly PointId[]): void;
  addPoint(id: PointId): void;
  removePoint(id: PointId): void;
  togglePoint(id: PointId): void;
  isPointSelected(id: PointId): boolean;
  selectSegments(ids: readonly SegmentId[]): void;
  addSegment(id: SegmentId): void;
  removeSegment(id: SegmentId): void;
  toggleSegment(id: SegmentId): void;
  isSegmentSelected(id: SegmentId): boolean;
  clear(): void;
  hasSelection(): boolean;
  setMode(mode: SelectionMode): void;
}

interface HoverService {
  getHoveredPoint(): PointId | null;
  getHoveredSegment(): SegmentIndicator | null;
  getHoveredBoundingBoxHandle(): BoundingBoxHitResult;
  setHoveredPoint(id: PointId | null): void;
  setHoveredSegment(indicator: SegmentIndicator | null): void;
  setHoveredBoundingBoxHandle(handle: BoundingBoxHitResult): void;
  clearAll(): void;
}

interface EditService {
  getGlyph(): GlyphSnapshot | null;
  getPointById(id: PointId): Point | null;
  getContourById(id: ContourId): Contour | null;
  getActiveContour(): Contour | null;
  addPoint(x: number, y: number, type: any, smooth?: boolean): PointId;
  addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    type: any,
    smooth: boolean,
  ): PointId;
  movePoints(ids: Iterable<PointId>, dx: number, dy: number): void;
  movePointTo(id: PointId, x: number, y: number): void;
  setPointPositions(moves: Array<{ id: PointId; x: number; y: number }>): void;
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

interface PreviewService {
  beginPreview(): void;
  cancelPreview(): void;
  commitPreview(label: string): void;
  isInPreview(): boolean;
  getPreviewSnapshot(): GlyphSnapshot | null;
}

interface TransformService {
  rotate(angle: number, origin?: Point2D): void;
  scale(sx: number, sy?: number, origin?: Point2D): void;
  reflect(axis: any, origin?: Point2D): void;
  rotate90CCW(): void;
  rotate90CW(): void;
  rotate180(): void;
  flipHorizontal(): void;
  flipVertical(): void;
  getSelectionBounds(): any | null;
  getSelectionCenter(): Point2D | null;
}

interface CursorService {
  get(): string;
  set(cursor: CursorType): void;
}

interface RenderService {
  requestRedraw(): void;
  requestImmediateRedraw(): void;
  cancelRedraw(): void;
  setPreviewMode(enabled: boolean): void;
  setHandlesVisible(visible: boolean): void;
}

interface ViewportService {
  getZoom(): number;
  pan(dx: number, dy: number): void;
  getPan(): Point2D;
  zoomIn(): void;
  zoomOut(): void;
  zoomToPoint(screenX: number, screenY: number, zoomDelta: number): void;
}

interface HitTestService {
  getPointAt(pos: Point2D): Point | null;
  getSegmentAt(pos: Point2D): any | null;
  getContourEndpointAt(pos: Point2D): ContourEndpointHit | null;
  getSelectionBoundingRect(): any | null;
  getAllPoints(): Point[];
  getSegmentById(segmentId: SegmentId): any | null;
  updateHover(pos: Point2D): void;
  getMiddlePointAt(pos: Point2D): any | null;
}

interface ToolSwitchService {
  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void;
  returnFromTemporary(): void;
}

interface ZoneService {
  getZone(): "canvas" | "sidebar" | "toolbar" | "modal";
}

interface ToolContext {
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
  readonly zone: ZoneService;
  tools: ToolSwitchService;
}

export interface MockToolContext extends ToolContext {
  fontEngine: FontEngine;
  getSelectedPoints(): readonly PointId[];
  getSelectedSegments(): readonly SegmentId[];
  getHoveredPoint(): PointId | null;
  getHoveredSegment(): SegmentIndicator | null;
  getCursorValue(): string;
  readonly hitRadius: number;
  readonly screenMousePosition: Signal<Point2D>;
  readonly activeToolState: Signal<{ type: string }>;
  getScreenMousePosition(): Point2D;
  screenToUpmDistance(pixels: number): number;
  hasSelection(): boolean;
  setActiveToolState(state: unknown): void;
  mocks: {
    screen: ReturnType<typeof createMockScreenService>;
    selection: ReturnType<typeof createMockSelectionService>;
    hover: ReturnType<typeof createMockHoverService>;
    edit: ReturnType<typeof createMockEditService>;
    preview: ReturnType<typeof createMockPreviewService>;
    transform: ReturnType<typeof createMockTransformService>;
    cursor: ReturnType<typeof createMockCursorService>;
    render: ReturnType<typeof createMockRenderService>;
    viewport: ReturnType<typeof createMockViewportService>;
    hitTest: ReturnType<typeof createMockHitTestService>;
    commands: ReturnType<typeof createMockCommandHistory>;
  };
}

function createMockScreenService(): ScreenService & {
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const mocks = {
    toUpmDistance: vi.fn((px: number) => px),
    lineWidth: vi.fn((px = 1) => px),
    projectScreenToUpm: vi.fn((x: number, y: number) => ({ x, y })),
    getMousePosition: vi.fn((x?: number, y?: number) => ({
      x: x ?? 0,
      y: y ?? 0,
    })),
  };

  return {
    toUpmDistance: mocks.toUpmDistance,
    get hitRadius() {
      return 8;
    },
    lineWidth: mocks.lineWidth,
    projectScreenToUpm: mocks.projectScreenToUpm,
    getMousePosition: mocks.getMousePosition,
    mocks,
  };
}

function createMockSelectionService(): SelectionService & {
  _selectedPoints: Set<PointId>;
  _selectedSegments: Set<SegmentId>;
  _mode: SelectionMode;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const _selectedPoints = new Set<PointId>();
  const _selectedSegments = new Set<SegmentId>();
  let _mode: SelectionMode = "committed";
  const $selectedPoints: WritableSignal<ReadonlySet<PointId>> = signal<ReadonlySet<PointId>>(
    new Set(),
  );
  const $selectedSegments: WritableSignal<ReadonlySet<SegmentId>> = signal<ReadonlySet<SegmentId>>(
    new Set(),
  );
  const $mode: WritableSignal<SelectionMode> = signal<SelectionMode>("committed");

  const updateSignals = () => {
    $selectedPoints.set(new Set(_selectedPoints));
    $selectedSegments.set(new Set(_selectedSegments));
    $mode.set(_mode);
  };

  const mocks = {
    selectPoints: vi.fn((ids: readonly PointId[]) => {
      _selectedPoints.clear();
      for (const id of ids) _selectedPoints.add(id);
      updateSignals();
    }),
    addPoint: vi.fn((id: PointId) => {
      _selectedPoints.add(id);
      updateSignals();
    }),
    removePoint: vi.fn((id: PointId) => {
      _selectedPoints.delete(id);
      updateSignals();
    }),
    togglePoint: vi.fn((id: PointId) => {
      if (_selectedPoints.has(id)) {
        _selectedPoints.delete(id);
      } else {
        _selectedPoints.add(id);
      }
      updateSignals();
    }),
    isPointSelected: vi.fn((id: PointId) => _selectedPoints.has(id)),
    selectSegments: vi.fn((ids: readonly SegmentId[]) => {
      _selectedSegments.clear();
      for (const id of ids) _selectedSegments.add(id);
      updateSignals();
    }),
    addSegment: vi.fn((id: SegmentId) => {
      _selectedSegments.add(id);
      updateSignals();
    }),
    removeSegment: vi.fn((id: SegmentId) => {
      _selectedSegments.delete(id);
      updateSignals();
    }),
    toggleSegment: vi.fn((id: SegmentId) => {
      if (_selectedSegments.has(id)) {
        _selectedSegments.delete(id);
      } else {
        _selectedSegments.add(id);
      }
      updateSignals();
    }),
    isSegmentSelected: vi.fn((id: SegmentId) => _selectedSegments.has(id)),
    clear: vi.fn(() => {
      _selectedPoints.clear();
      _selectedSegments.clear();
      updateSignals();
    }),
    hasSelection: vi.fn(() => _selectedPoints.size > 0 || _selectedSegments.size > 0),
    setMode: vi.fn((mode: SelectionMode) => {
      _mode = mode;
      updateSignals();
    }),
  };

  return {
    getSelectedPoints: () => [..._selectedPoints] as readonly PointId[],
    getSelectedSegments: () => [..._selectedSegments] as readonly SegmentId[],
    getSelectedPointsCount: () => _selectedPoints.size,
    getSelectedSegmentsCount: () => _selectedSegments.size,
    getMode: () => _mode,
    selectPoints: mocks.selectPoints,
    addPoint: mocks.addPoint,
    removePoint: mocks.removePoint,
    togglePoint: mocks.togglePoint,
    isPointSelected: mocks.isPointSelected,
    selectSegments: mocks.selectSegments,
    addSegment: mocks.addSegment,
    removeSegment: mocks.removeSegment,
    toggleSegment: mocks.toggleSegment,
    isSegmentSelected: mocks.isSegmentSelected,
    clear: mocks.clear,
    hasSelection: mocks.hasSelection,
    setMode: mocks.setMode,
    _selectedPoints,
    _selectedSegments,
    get _mode() {
      return _mode;
    },
    set _mode(m: SelectionMode) {
      _mode = m;
    },
    mocks,
  };
}

function createMockHoverService(): HoverService & {
  _hoveredPoint: PointId | null;
  _hoveredSegment: SegmentIndicator | null;
  _hoveredBoundingBoxHandle: BoundingBoxHitResult;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  let _hoveredPoint: PointId | null = null;
  let _hoveredSegment: SegmentIndicator | null = null;
  let _hoveredBoundingBoxHandle: BoundingBoxHitResult = null;
  const $hoveredPoint: WritableSignal<PointId | null> = signal<PointId | null>(null);
  const $hoveredSegment: WritableSignal<SegmentIndicator | null> = signal<SegmentIndicator | null>(
    null,
  );

  const mocks = {
    setHoveredPoint: vi.fn((id: PointId | null) => {
      _hoveredPoint = id;
      if (id !== null) _hoveredSegment = null;
      $hoveredPoint.set(id);
      $hoveredSegment.set(_hoveredSegment);
    }),
    setHoveredSegment: vi.fn((indicator: SegmentIndicator | null) => {
      _hoveredSegment = indicator;
      if (indicator !== null) _hoveredPoint = null;
      $hoveredSegment.set(indicator);
      $hoveredPoint.set(_hoveredPoint);
    }),
    setHoveredBoundingBoxHandle: vi.fn((handle: BoundingBoxHitResult) => {
      _hoveredBoundingBoxHandle = handle;
    }),
    clearAll: vi.fn(() => {
      _hoveredPoint = null;
      _hoveredSegment = null;
      _hoveredBoundingBoxHandle = null;
      $hoveredPoint.set(null);
      $hoveredSegment.set(null);
    }),
  };

  return {
    getHoveredPoint: () => _hoveredPoint,
    getHoveredSegment: () => _hoveredSegment,
    getHoveredBoundingBoxHandle: () => _hoveredBoundingBoxHandle,
    setHoveredPoint: mocks.setHoveredPoint,
    setHoveredSegment: mocks.setHoveredSegment,
    setHoveredBoundingBoxHandle: mocks.setHoveredBoundingBoxHandle,
    clearAll: mocks.clearAll,
    get _hoveredPoint() {
      return _hoveredPoint;
    },
    get _hoveredSegment() {
      return _hoveredSegment;
    },
    get _hoveredBoundingBoxHandle() {
      return _hoveredBoundingBoxHandle;
    },
    mocks,
  };
}

function createMockEditService(
  fontEngine: FontEngine,
): EditService & { mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const getPointById = (pointId: PointId): Point | null => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    for (const contour of snapshot.contours) {
      const point = contour.points.find((p) => p.id === pointId);
      if (point) return point as Point;
    }
    return null;
  };

  const getContourById = (contourId: ContourId): Contour | null => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    const contour = snapshot.contours.find((c) => c.id === contourId);
    return contour ? (contour as Contour) : null;
  };

  const getActiveContour = (): Contour | null => {
    const activeContourId = fontEngine.editing.getActiveContourId();
    if (!activeContourId) return null;
    return getContourById(asContourId(activeContourId));
  };

  const mocks = {
    addPoint: vi.fn((x: number, y: number, type: any, smooth = false) =>
      fontEngine.editing.addPoint(x, y, type, smooth),
    ),
    addPointToContour: vi.fn(
      (contourId: ContourId, x: number, y: number, type: any, smooth: boolean) =>
        fontEngine.editing.addPointToContour(contourId, x, y, type, smooth),
    ),
    movePoints: vi.fn((ids: Iterable<PointId>, dx: number, dy: number) =>
      fontEngine.editing.movePoints([...ids], dx, dy),
    ),
    movePointTo: vi.fn((id: PointId, x: number, y: number) =>
      fontEngine.editing.movePointTo(id, x, y),
    ),
    setPointPositions: vi.fn((moves: Array<{ id: PointId; x: number; y: number }>) =>
      fontEngine.editing.setPointPositions(moves),
    ),
    applySmartEdits: vi.fn((ids: readonly PointId[], dx: number, dy: number) =>
      fontEngine.editing.applySmartEdits(new Set(ids), dx, dy),
    ),
    removePoints: vi.fn((ids: Iterable<PointId>) => fontEngine.editing.removePoints([...ids])),
    addContour: vi.fn(() => fontEngine.editing.addContour()),
    closeContour: vi.fn(() => fontEngine.editing.closeContour()),
    toggleSmooth: vi.fn((id: PointId) => fontEngine.editing.toggleSmooth(id)),
    getActiveContourId: vi.fn(() => {
      const id = fontEngine.editing.getActiveContourId();
      return id ? asContourId(id) : null;
    }),
    setActiveContour: vi.fn((contourId: ContourId) =>
      fontEngine.editing.setActiveContour(contourId),
    ),
    clearActiveContour: vi.fn(() => fontEngine.editing.clearActiveContour()),
    reverseContour: vi.fn((contourId: ContourId) => fontEngine.editing.reverseContour(contourId)),
    getPointById: vi.fn(getPointById),
    getContourById: vi.fn(getContourById),
    getActiveContour: vi.fn(getActiveContour),
  };

  return {
    getGlyph: () => fontEngine.$glyph.value,
    getPointById: mocks.getPointById,
    getContourById: mocks.getContourById,
    getActiveContour: mocks.getActiveContour,
    addPoint: mocks.addPoint,
    addPointToContour: mocks.addPointToContour,
    movePoints: mocks.movePoints,
    movePointTo: mocks.movePointTo,
    setPointPositions: mocks.setPointPositions,
    applySmartEdits: mocks.applySmartEdits,
    removePoints: mocks.removePoints,
    addContour: mocks.addContour,
    closeContour: mocks.closeContour,
    toggleSmooth: mocks.toggleSmooth,
    getActiveContourId: mocks.getActiveContourId,
    setActiveContour: mocks.setActiveContour,
    clearActiveContour: mocks.clearActiveContour,
    reverseContour: mocks.reverseContour,
    mocks,
  };
}

function createMockPreviewService(fontEngine: FontEngine): PreviewService & {
  _previewSnapshot: GlyphSnapshot | null;
  _isInPreview: boolean;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  let _previewSnapshot: GlyphSnapshot | null = null;
  let _isInPreview = false;

  const mocks = {
    beginPreview: vi.fn(() => {
      if (!_isInPreview) {
        _previewSnapshot = fontEngine.$glyph.value;
        _isInPreview = true;
      }
    }),
    cancelPreview: vi.fn(() => {
      if (_isInPreview && _previewSnapshot) {
        fontEngine.editing.restoreSnapshot(_previewSnapshot);
      }
      _previewSnapshot = null;
      _isInPreview = false;
    }),
    commitPreview: vi.fn(() => {
      _previewSnapshot = null;
      _isInPreview = false;
    }),
    isInPreview: vi.fn(() => _isInPreview),
    getPreviewSnapshot: vi.fn(() => _previewSnapshot),
  };

  return {
    beginPreview: mocks.beginPreview,
    cancelPreview: mocks.cancelPreview,
    commitPreview: mocks.commitPreview,
    isInPreview: mocks.isInPreview,
    getPreviewSnapshot: mocks.getPreviewSnapshot,
    get _previewSnapshot() {
      return _previewSnapshot;
    },
    get _isInPreview() {
      return _isInPreview;
    },
    mocks,
  };
}

function createMockTransformService(): TransformService & {
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const mocks = {
    rotate: vi.fn(),
    scale: vi.fn(),
    reflect: vi.fn(),
    rotate90CCW: vi.fn(),
    rotate90CW: vi.fn(),
    rotate180: vi.fn(),
    flipHorizontal: vi.fn(),
    flipVertical: vi.fn(),
    getSelectionBounds: vi.fn(() => null),
    getSelectionCenter: vi.fn(() => null),
  };

  return {
    rotate: mocks.rotate,
    scale: mocks.scale,
    reflect: mocks.reflect,
    rotate90CCW: mocks.rotate90CCW,
    rotate90CW: mocks.rotate90CW,
    rotate180: mocks.rotate180,
    flipHorizontal: mocks.flipHorizontal,
    flipVertical: mocks.flipVertical,
    getSelectionBounds: mocks.getSelectionBounds,
    getSelectionCenter: mocks.getSelectionCenter,
    mocks,
  };
}

function createMockCursorService(): CursorService & {
  _cursor: string;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  let _cursor = "default";
  const $cursor: WritableSignal<string> = signal("default");

  const mocks = {
    set: vi.fn((cursor: CursorType) => {
      _cursor = cursor.type;
      $cursor.set(_cursor);
    }),
  };

  return {
    get: () => _cursor,
    set: mocks.set,
    get _cursor() {
      return _cursor;
    },
    mocks,
  };
}

function createMockRenderService(): RenderService & {
  _previewMode: boolean;
  _handlesVisible: boolean;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  let _previewMode = false;
  let _handlesVisible = true;

  const mocks = {
    requestRedraw: vi.fn(),
    requestImmediateRedraw: vi.fn(),
    cancelRedraw: vi.fn(),
    setPreviewMode: vi.fn((enabled: boolean) => {
      _previewMode = enabled;
    }),
    setHandlesVisible: vi.fn((visible: boolean) => {
      _handlesVisible = visible;
    }),
  };

  return {
    requestRedraw: mocks.requestRedraw,
    requestImmediateRedraw: mocks.requestImmediateRedraw,
    cancelRedraw: mocks.cancelRedraw,
    setPreviewMode: mocks.setPreviewMode,
    setHandlesVisible: mocks.setHandlesVisible,
    get _previewMode() {
      return _previewMode;
    },
    get _handlesVisible() {
      return _handlesVisible;
    },
    mocks,
  };
}

function createMockViewportService(): ViewportService & {
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const $zoom: WritableSignal<number> = signal(1);
  let _panX = 0;
  let _panY = 0;

  const mocks = {
    pan: vi.fn((dx: number, dy: number) => {
      _panX = dx;
      _panY = dy;
    }),
    getPan: vi.fn(() => ({ x: _panX, y: _panY })),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomToPoint: vi.fn(),
  };

  return {
    getZoom: () => $zoom.value,
    pan: mocks.pan,
    getPan: mocks.getPan,
    zoomIn: mocks.zoomIn,
    zoomOut: mocks.zoomOut,
    zoomToPoint: mocks.zoomToPoint,
    mocks,
  };
}

function createMockHitTestService(
  fontEngine: FontEngine,
): HitTestService & { mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const hitRadius = 8;

  const getPointAt = (pos: Point2D) => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    for (const contour of snapshot.contours) {
      for (const point of contour.points) {
        const dist = Math.sqrt((point.x - pos.x) ** 2 + (point.y - pos.y) ** 2);
        if (dist < hitRadius) {
          return point;
        }
      }
    }
    return null;
  };

  const getSegmentAt = (pos: Point2D): SegmentHitResult | null => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    let bestHit: SegmentHitResult | null = null;

    for (const contour of snapshot.contours) {
      const segments = SegmentOps.parse(contour.points, contour.closed);
      const hit = SegmentOps.hitTestMultiple(segments, pos, hitRadius);
      if (hit && (bestHit === null || hit.distance < bestHit.distance)) {
        bestHit = hit;
      }
    }

    return bestHit;
  };

  const getContourEndpointAt = (pos: Point2D) => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    for (const contour of snapshot.contours) {
      if (contour.closed || contour.points.length === 0) continue;

      const firstPoint = contour.points[0];
      const lastPoint = contour.points[contour.points.length - 1];

      const firstDist = Math.sqrt((firstPoint.x - pos.x) ** 2 + (firstPoint.y - pos.y) ** 2);
      if (firstDist < hitRadius) {
        return {
          contourId: asContourId(contour.id),
          pointId: asPointId(firstPoint.id),
          position: "start" as const,
          contour,
        };
      }

      const lastDist = Math.sqrt((lastPoint.x - pos.x) ** 2 + (lastPoint.y - pos.y) ** 2);
      if (lastDist < hitRadius) {
        return {
          contourId: asContourId(contour.id),
          pointId: asPointId(lastPoint.id),
          position: "end" as const,
          contour,
        };
      }
    }
    return null;
  };

  const getAllPoints = () => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return [];

    const result: any[] = [];
    for (const contour of snapshot.contours) {
      result.push(...contour.points);
    }
    return result;
  };

  const getSegmentById = (segmentId: SegmentId) => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    for (const contour of snapshot.contours) {
      const segments = SegmentOps.parse(contour.points, contour.closed);
      for (const segment of segments) {
        if (SegmentOps.id(segment) === segmentId) {
          return segment;
        }
      }
    }
    return null;
  };

  const getMiddlePointAt = (pos: Point2D) => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    const activeContourId = fontEngine.editing.getActiveContourId();

    for (const contour of snapshot.contours) {
      if (contour.id === activeContourId || contour.closed) continue;
      if (contour.points.length < 3) continue;

      for (let i = 1; i < contour.points.length - 1; i++) {
        const point = contour.points[i];
        const dist = Math.sqrt((point.x - pos.x) ** 2 + (point.y - pos.y) ** 2);
        if (dist < hitRadius) {
          return {
            type: "middlePoint" as const,
            contourId: asContourId(contour.id),
            pointId: asPointId(point.id),
            pointIndex: i,
          };
        }
      }
    }
    return null;
  };

  const mocks = {
    getPointAt: vi.fn(getPointAt),
    getSegmentAt: vi.fn(getSegmentAt),
    getContourEndpointAt: vi.fn(getContourEndpointAt),
    getSelectionBoundingRect: vi.fn(() => null),
    getAllPoints: vi.fn(getAllPoints),
    getSegmentById: vi.fn(getSegmentById),
    updateHover: vi.fn(),
    getMiddlePointAt: vi.fn(getMiddlePointAt),
  };

  return {
    getPointAt: mocks.getPointAt,
    getSegmentAt: mocks.getSegmentAt,
    getContourEndpointAt: mocks.getContourEndpointAt,
    getSelectionBoundingRect: mocks.getSelectionBoundingRect,
    getAllPoints: mocks.getAllPoints,
    getSegmentById: mocks.getSegmentById,
    updateHover: mocks.updateHover,
    getMiddlePointAt: mocks.getMiddlePointAt,
    mocks,
  };
}

function createMockCommandHistory(
  fontEngine: FontEngine,
): CommandHistory & { mocks: Record<string, ReturnType<typeof vi.fn>> } {
  let _isBatching = false;

  const mocks = {
    execute: vi.fn((cmd: any) =>
      cmd.execute?.({
        fontEngine,
        glyph: fontEngine.$glyph.value,
      }),
    ),
    record: vi.fn(),
    beginBatch: vi.fn(() => {
      _isBatching = true;
    }),
    endBatch: vi.fn(() => {
      _isBatching = false;
    }),
    cancelBatch: vi.fn(() => {
      _isBatching = false;
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    clear: vi.fn(),
  };

  return {
    execute: mocks.execute,
    record: mocks.record,
    beginBatch: mocks.beginBatch,
    endBatch: mocks.endBatch,
    cancelBatch: mocks.cancelBatch,
    get isBatching() {
      return _isBatching;
    },
    undo: mocks.undo,
    redo: mocks.redo,
    clear: mocks.clear,
    mocks,
  } as unknown as CommandHistory & {
    mocks: Record<string, ReturnType<typeof vi.fn>>;
  };
}

export function createMockToolContext(): MockToolContext {
  const fontEngine = new FontEngine(new MockFontEngine());
  fontEngine.session.startEditSession(65);
  fontEngine.editing.addContour();

  const screen = createMockScreenService();
  const selection = createMockSelectionService();
  const hover = createMockHoverService();
  const edit = createMockEditService(fontEngine);
  const preview = createMockPreviewService(fontEngine);
  const transform = createMockTransformService();
  const cursor = createMockCursorService();
  const render = createMockRenderService();
  const viewport = createMockViewportService();
  const hitTest = createMockHitTestService(fontEngine);
  const commands = createMockCommandHistory(fontEngine);
  const tools: ToolSwitchService = {
    requestTemporary: vi.fn(),
    returnFromTemporary: vi.fn(),
  };

  const zone = {
    getZone: vi.fn().mockReturnValue("canvas" as const),
  };

  const $screenMousePosition = signal<Point2D>({ x: 0, y: 0 });
  const $activeToolState = signal<{ type: string }>({ type: "idle" });

  return {
    screen,
    selection,
    hover,
    edit,
    preview,
    transform,
    cursor,
    render,
    viewport,
    hitTest,
    commands,
    zone,
    tools,
    fontEngine,
    getSelectedPoints: () => [...selection._selectedPoints] as readonly PointId[],
    getSelectedSegments: () => [...selection._selectedSegments] as readonly SegmentId[],
    getHoveredPoint: () => hover._hoveredPoint,
    getHoveredSegment: () => hover._hoveredSegment,
    getCursorValue: () => cursor._cursor,
    get hitRadius() {
      return 8;
    },
    get screenMousePosition() {
      return $screenMousePosition;
    },
    get activeToolState() {
      return $activeToolState;
    },
    getScreenMousePosition: () => $screenMousePosition.peek(),
    screenToUpmDistance: (pixels: number) => pixels,
    hasSelection: () => selection.hasSelection(),
    setActiveToolState: (state: unknown) => {
      $activeToolState.value = state as { type: string };
    },
    mocks: {
      screen,
      selection,
      hover,
      edit,
      preview,
      transform,
      cursor,
      render,
      viewport,
      hitTest,
      commands,
    },
  };
}

export function createToolMouseEvent(
  x: number,
  y: number,
  options?: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    button?: number;
  },
): ToolMouseEvent {
  return {
    screen: { x, y },
    upm: { x, y },
    shiftKey: options?.shiftKey ?? false,
    ctrlKey: options?.ctrlKey ?? false,
    metaKey: options?.metaKey ?? false,
    altKey: options?.altKey ?? false,
    button: options?.button ?? 0,
  };
}

export interface ToolEventTarget {
  handleEvent(event: import("@/lib/tools/core/GestureDetector").ToolEvent): void;
  activate?(): void;
  deactivate?(): void;
}

export class ToolEventSimulator {
  private mouseDown = false;
  private downPoint: Point2D | null = null;
  private downScreenPoint: Point2D | null = null;

  constructor(private tool: ToolEventTarget) {}

  setReady(): void {
    this.tool.activate?.();
  }

  setIdle(): void {
    this.tool.deactivate?.();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.mouseDown = true;
    this.downPoint = event.upm;
    this.downScreenPoint = event.screen;
    this.tool.handleEvent({
      type: "dragStart",
      point: event.upm,
      screenPoint: event.screen,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.mouseDown && this.downPoint && this.downScreenPoint) {
      this.tool.handleEvent({
        type: "drag",
        point: event.upm,
        screenPoint: event.screen,
        origin: this.downPoint,
        screenOrigin: this.downScreenPoint,
        delta: {
          x: event.upm.x - this.downPoint.x,
          y: event.upm.y - this.downPoint.y,
        },
        screenDelta: {
          x: event.screen.x - this.downScreenPoint.x,
          y: event.screen.y - this.downScreenPoint.y,
        },
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
    } else {
      this.tool.handleEvent({
        type: "pointerMove",
        point: event.upm,
      });
    }
  }

  onMouseUp(event: ToolMouseEvent): void {
    if (this.mouseDown && this.downPoint && this.downScreenPoint) {
      this.tool.handleEvent({
        type: "dragEnd",
        point: event.upm,
        screenPoint: event.screen,
        origin: this.downPoint,
        screenOrigin: this.downScreenPoint,
      });
    }
    this.mouseDown = false;
    this.downPoint = null;
    this.downScreenPoint = null;
  }

  cancel(): void {
    this.tool.handleEvent({
      type: "keyDown",
      key: "Escape",
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
  }

  keyDown(
    key: string,
    options?: { shiftKey?: boolean; altKey?: boolean; metaKey?: boolean },
  ): void {
    this.tool.handleEvent({
      type: "keyDown",
      key,
      shiftKey: options?.shiftKey ?? false,
      altKey: options?.altKey ?? false,
      metaKey: options?.metaKey ?? false,
    });
  }

  keyUp(key: string): void {
    this.tool.handleEvent({
      type: "keyUp",
      key,
    });
  }
}
