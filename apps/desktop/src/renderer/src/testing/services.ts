import { vi } from "vitest";
import type { PointId, ContourId, GlyphSnapshot, Point, Contour, Glyph } from "@shift/types";
import type { EditorAPI, ActiveToolState } from "@/lib/tools/core";
import type { ToolEvent, Modifiers } from "@/lib/tools/core/GestureDetector";
import { asContourId, asPointId } from "@shift/types";
import type { ToolName } from "@/lib/tools/core";
import type { ContourEndpointHit, HitResult } from "@/types/hitResult";
import type { TemporaryToolOptions, SnapPreferences } from "@/types/editor";
import type { CommandHistory } from "@/lib/commands";
import type { SelectionMode, CursorType } from "@/types/editor";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { Point2D, Rect2D } from "@shift/types";
import { signal, computed, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { Coordinates } from "@/types/coordinates";
import type {
  DragSnapSession,
  DragSnapSessionConfig,
  RotateSnapSession,
} from "@/lib/editor/snapping/types";

/** For tests: build Coordinates with the same point in all three spaces. */
export function makeTestCoordinates(p: Point2D): Coordinates {
  return { screen: { ...p }, scene: { ...p }, glyphLocal: { ...p } };
}

/**
 * For tests: build Coordinates from scene space with an explicit draw offset.
 * Screen defaults to scene unless a custom screen point is provided.
 */
export function makeTestCoordinatesFromScene(
  scene: Point2D,
  drawOffset: Point2D,
  screen: Point2D = scene,
): Coordinates {
  return {
    screen: { ...screen },
    scene: { ...scene },
    glyphLocal: {
      x: scene.x - drawOffset.x,
      y: scene.y - drawOffset.y,
    },
  };
}

/** For tests: build Coordinates from glyph-local space with an explicit draw offset. */
export function makeTestCoordinatesFromGlyphLocal(
  glyphLocal: Point2D,
  drawOffset: Point2D,
  screen?: Point2D,
): Coordinates {
  const scene = {
    x: glyphLocal.x + drawOffset.x,
    y: glyphLocal.y + drawOffset.y,
  };
  return {
    screen: { ...(screen ?? scene) },
    scene,
    glyphLocal: { ...glyphLocal },
  };
}

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
import { TextRunManager } from "@/lib/editor/managers/TextRunManager";
import { Segment as SegmentOps, type SegmentHitResult } from "@/lib/geo/Segment";

interface ScreenService {
  toUpmDistance(pixels: number): number;
  readonly hitRadius: number;
  lineWidth(pixels?: number): number;
  projectScreenToScene(x: number, y: number): Point2D;
  projectSceneToScreen(x: number, y: number): Point2D;
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
  readonly hoveredPointId: Signal<PointId | null>;
  readonly hoveredSegmentId: Signal<SegmentIndicator | null>;
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
  requestStaticRedraw(): void;
  requestImmediateRedraw(): void;
  cancelRedraw(): void;
  isPreviewMode(): boolean;
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
  getNodeAt(coords: Coordinates): HitResult;
  getPointAt(coords: Coordinates): Point | null;
  getSegmentAt(coords: Coordinates): any | null;
  getContourEndpointAt(coords: Coordinates): ContourEndpointHit | null;
  getSelectionBoundingRect(): any | null;
  getAllPoints(): Point[];
  getSegmentById(segmentId: SegmentId): any | null;
  updateHover(coords: Coordinates): void;
  getMiddlePointAt(coords: Coordinates): any | null;
}

interface ToolSwitchService {
  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void;
  returnFromTemporary(): void;
}

export interface MockToolContext extends EditorAPI {
  readonly fontEngine: FontEngine;
  readonly textRunManager: TextRunManager;
  readonly screen: ReturnType<typeof createMockScreenService>;
  readonly selection: ReturnType<typeof createMockSelectionService>;
  readonly hover: ReturnType<typeof createMockHoverService> & {
    setHoveredBoundingBoxHandle(handle: BoundingBoxHitResult): void;
  };
  readonly edit: ReturnType<typeof createMockEditService>;
  readonly preview: ReturnType<typeof createMockPreviewService>;
  readonly transform: ReturnType<typeof createMockTransformService>;
  readonly cursor: ReturnType<typeof createMockCursorService>;
  readonly render: ReturnType<typeof createMockRenderService>;
  readonly viewport: ReturnType<typeof createMockViewportService>;
  readonly hitTest: ReturnType<typeof createMockHitTestService>;
  readonly zone: { getZone(): "canvas" | "sidebar" | "toolbar" | "modal" };
  tools: ToolSwitchService;
  getSelectionMode(): SelectionMode;
  getHoveredPoint(): PointId | null;
  getHoveredSegment(): SegmentIndicator | null;
  getCursorValue(): string;
  readonly screenMousePosition: Signal<Point2D>;
  getAllPoints(): Point[];
  addPoint(x: number, y: number, type: unknown, smooth?: boolean): PointId;
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
    projectScreenToScene: vi.fn((x: number, y: number) => ({ x, y })),
    projectSceneToScreen: vi.fn((x: number, y: number) => ({ x, y })),
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
    projectScreenToScene: mocks.projectScreenToScene,
    projectSceneToScreen: mocks.projectSceneToScreen,
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
    get hoveredPointId() {
      return $hoveredPoint;
    },
    get hoveredSegmentId() {
      return $hoveredSegment;
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
      fontEngine.editing.addPoint({ id: "" as PointId, x, y, pointType: type, smooth }),
    ),
    addPointToContour: vi.fn(
      (contourId: ContourId, x: number, y: number, type: any, smooth: boolean) =>
        fontEngine.editing.addPointToContour(contourId, {
          id: "" as PointId,
          x,
          y,
          pointType: type,
          smooth,
        }),
    ),
    movePoints: vi.fn((ids: Iterable<PointId>, dx: number, dy: number) =>
      fontEngine.editing.movePoints([...ids], { x: dx, y: dy }),
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
    requestStaticRedraw: vi.fn(),
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
    requestStaticRedraw: mocks.requestStaticRedraw,
    requestImmediateRedraw: mocks.requestImmediateRedraw,
    cancelRedraw: mocks.cancelRedraw,
    isPreviewMode: () => _previewMode,
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
          type: "contourEndpoint" as const,
          contourId: asContourId(contour.id),
          pointId: asPointId(firstPoint.id),
          position: "start" as const,
          contour,
        };
      }

      const lastDist = Math.sqrt((lastPoint.x - pos.x) ** 2 + (lastPoint.y - pos.y) ** 2);
      if (lastDist < hitRadius) {
        return {
          type: "contourEndpoint" as const,
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

  const getNodeAt = (coords: Coordinates): HitResult => {
    const pos = coords.scene;
    const endpoint = getContourEndpointAt(pos);
    if (endpoint) return endpoint;

    const middle = getMiddlePointAt(pos);
    if (middle) return middle;

    const point = getPointAt(pos);
    if (point) return { type: "point", point, pointId: point.id };

    const segmentHit = getSegmentAt(pos);
    if (segmentHit)
      return {
        type: "segment",
        segment: segmentHit.segment,
        segmentId: segmentHit.segmentId,
        t: segmentHit.t,
        closestPoint: segmentHit.point,
      };

    return null;
  };

  const getPointAtCoords = (coords: Coordinates) => getPointAt(coords.scene);
  const getSegmentAtCoords = (coords: Coordinates) => getSegmentAt(coords.scene);
  const getContourEndpointAtCoords = (coords: Coordinates) => getContourEndpointAt(coords.scene);
  const getMiddlePointAtCoords = (coords: Coordinates) => getMiddlePointAt(coords.scene);

  const mocks = {
    getNodeAt: vi.fn(getNodeAt),
    getPointAt: vi.fn(getPointAtCoords),
    getSegmentAt: vi.fn(getSegmentAtCoords),
    getContourEndpointAt: vi.fn(getContourEndpointAtCoords),
    getSelectionBoundingRect: vi.fn(() => null),
    getAllPoints: vi.fn(getAllPoints),
    getSegmentById: vi.fn(getSegmentById),
    updateHover: vi.fn(),
    getMiddlePointAt: vi.fn(getMiddlePointAtCoords),
  };

  return {
    getNodeAt: mocks.getNodeAt,
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
  const $hoveredBoundingBoxHandle = signal<BoundingBoxHitResult>(null as BoundingBoxHitResult);
  const hoverProxy = {
    ...hover,
    setHoveredBoundingBoxHandle(handle: BoundingBoxHitResult) {
      hover.setHoveredBoundingBoxHandle(handle);
      $hoveredBoundingBoxHandle.set(handle);
    },
  };
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

  const textRunManager = new TextRunManager();
  let mainGlyphUnicode: number | null = 65;
  textRunManager.setOwnerGlyph(mainGlyphUnicode);

  const font = {
    getMetrics: () => ({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
      italicAngle: null,
      underlinePosition: null,
      underlineThickness: null,
    }),
    getMetadata: () => ({
      familyName: "Test",
      styleName: null,
      versionMajor: 1,
      versionMinor: 0,
      copyright: null,
      trademark: null,
      designer: null,
      designerUrl: null,
      manufacturer: null,
      manufacturerUrl: null,
      license: null,
      licenseUrl: null,
      description: null,
      note: null,
    }),
    getSvgPath: (_unicode: number) => null as string | null,
    getAdvance: (_unicode: number) => null as number | null,
    getBbox: (_unicode: number) => null,
  };

  const zone = {
    getZone: vi.fn().mockReturnValue("canvas" as const),
  };

  const $screenMousePosition = signal<Point2D>({ x: 0, y: 0 });
  const $activeToolState = signal<ActiveToolState>({ type: "idle" });
  const $currentModifiers = signal<Modifiers>({
    shiftKey: false,
    altKey: false,
    metaKey: false,
  });
  const $isHoveringNode = computed(
    () => hover.hoveredPointId.value !== null || hover.hoveredSegmentId.value !== null,
  );
  const $snapPreferences = signal<SnapPreferences>({
    enabled: true,
    angle: true,
    metrics: false,
    pointToPoint: false,
    angleIncrementDeg: 45,
    pointRadiusPx: 8,
  });
  const toolState = {
    app: new Map<string, unknown>(),
    document: new Map<string, unknown>(),
  };
  let drawOffset: Point2D = { x: 0, y: 0 };

  function createDragSnapSession(config: DragSnapSessionConfig): DragSnapSession {
    let previous: number | null = null;
    const anchor = config.dragStart;
    return {
      getAnchorPosition: () => anchor,
      snap: (point: Point2D, modifiers: { shiftKey: boolean }) => {
        if (!modifiers.shiftKey) {
          previous = null;
          return { point, source: null, indicator: null };
        }
        const delta = { x: point.x - config.dragStart.x, y: point.y - config.dragStart.y };
        const snappedAngle =
          Math.round(Math.atan2(delta.y, delta.x) / (Math.PI / 4)) * (Math.PI / 4);
        previous = snappedAngle;
        const len = Math.hypot(delta.x, delta.y);
        const snappedPoint = {
          x: config.dragStart.x + Math.cos(previous) * len,
          y: config.dragStart.y + Math.sin(previous) * len,
        };
        return {
          point: snappedPoint,
          source: "angle",
          indicator: { lines: [{ from: config.dragStart, to: snappedPoint }] },
        };
      },
      clear: () => {
        previous = null;
      },
    };
  }

  function createRotateSnapSession(): RotateSnapSession {
    let previous: number | null = null;
    return {
      snap: (delta: number, modifiers: { shiftKey: boolean }) => {
        if (!modifiers.shiftKey) {
          previous = null;
          return { delta, source: null };
        }
        const snappedDelta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
        previous = snappedDelta;
        return { delta: previous, source: "angle" };
      },
      clear: () => {
        previous = null;
      },
    };
  }

  return {
    getDrawOffset: vi.fn(() => drawOffset),
    setDrawOffset: vi.fn((offset: Point2D) => {
      drawOffset = offset;
    }),
    fontEngine,
    screen,
    selection,
    hover: hoverProxy,
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
    getSelectedPoints: () => [...selection.getSelectedPoints()],
    getSelectedSegments: () => [...selection.getSelectedSegments()],
    getHoveredPoint: () => hover.getHoveredPoint(),
    getHoveredSegment: () => hover.getHoveredSegment(),
    getCursorValue: () => cursor.get(),
    get hitRadius() {
      return 8;
    },
    get screenMousePosition() {
      return $screenMousePosition;
    },
    get activeToolState() {
      return $activeToolState;
    },
    getMousePosition: () =>
      screen.projectScreenToScene($screenMousePosition.peek().x, $screenMousePosition.peek().y),
    getScreenMousePosition: () => $screenMousePosition.peek(),
    flushMousePosition: () => {},
    projectScreenToScene: (x: number, y: number) => screen.projectScreenToScene(x, y),
    projectSceneToScreen: (x: number, y: number) => screen.projectSceneToScreen(x, y),
    sceneToGlyphLocal: (point: Point2D) => ({
      x: point.x - drawOffset.x,
      y: point.y - drawOffset.y,
    }),
    glyphLocalToScene: (point: Point2D) => ({
      x: point.x + drawOffset.x,
      y: point.y + drawOffset.y,
    }),
    fromScreen: (sx: number, sy: number) =>
      makeTestCoordinatesFromScene(screen.projectScreenToScene(sx, sy), drawOffset, {
        x: sx,
        y: sy,
      }),
    fromScene: (x: number, y: number) => makeTestCoordinatesFromScene({ x, y }, drawOffset),
    fromGlyphLocal: (x: number, y: number) =>
      makeTestCoordinatesFromGlyphLocal({ x, y }, drawOffset),
    screenToUpmDistance: (pixels: number) => pixels,
    hasSelection: () => selection.hasSelection(),
    getActiveToolState: () => $activeToolState.value,
    setActiveToolState: (state: ActiveToolState) => {
      $activeToolState.value = state;
    },
    selectPoints: (ids: readonly PointId[]) => selection.selectPoints(ids),
    clearSelection: () => selection.clear(),
    setSelectionMode: (mode: SelectionMode) => selection.setMode(mode),
    getSelectionMode: () => selection.getMode(),
    addPointToSelection: (id: PointId) => selection.addPoint(id),
    removePointFromSelection: (id: PointId) => selection.removePoint(id),
    togglePointSelection: (id: PointId) => selection.togglePoint(id),
    isPointSelected: (id: PointId) => selection.isPointSelected(id),
    selectSegments: (ids: readonly SegmentId[]) => selection.selectSegments(ids),
    addSegmentToSelection: (id: SegmentId) => selection.addSegment(id),
    removeSegmentFromSelection: (id: SegmentId) => selection.removeSegment(id),
    toggleSegmentInSelection: (id: SegmentId) => selection.toggleSegment(id),
    isSegmentSelected: (id: SegmentId) => selection.isSegmentSelected(id),
    glyph: computed<Glyph | null>(() => edit.getGlyph() as Glyph | null),
    font,
    addPoint: (x: number, y: number, type: any, smooth?: boolean) =>
      edit.addPoint(x, y, type, smooth),
    movePointTo: (id: PointId, x: number, y: number) => edit.movePointTo(id, x, y),
    setPointPositions: (moves: Array<{ id: PointId; x: number; y: number }>) =>
      edit.setPointPositions(moves),
    applySmartEdits: (ids: readonly PointId[], dx: number, dy: number) =>
      edit.applySmartEdits(ids, dx, dy),
    toggleSmooth: (id: PointId) => edit.toggleSmooth(id),
    getActiveContourId: () => edit.getActiveContourId(),
    getActiveContour: () => edit.getActiveContour(),
    setActiveContour: (id: ContourId) => edit.setActiveContour(id),
    clearActiveContour: () => edit.clearActiveContour(),
    beginPreview: () => preview.beginPreview(),
    cancelPreview: () => preview.cancelPreview(),
    commitPreview: (label: string) => preview.commitPreview(label),
    requestRedraw: () => render.requestRedraw(),
    requestStaticRedraw: () => render.requestStaticRedraw(),
    isPreviewMode: () => render.isPreviewMode(),
    setPreviewMode: (enabled: boolean) => render.setPreviewMode(enabled),
    setHandlesVisible: (visible: boolean) => render.setHandlesVisible(visible),
    setMarqueePreviewRect: (_rect: Rect2D | null) => {},
    isPointInMarqueePreview: (_pointId: PointId) => false,
    getNodeAt: (coords: Coordinates) => hitTest.getNodeAt(coords),
    getPointAt: (coords: Coordinates) => hitTest.getPointAt(coords),
    getSegmentAt: (coords: Coordinates) => hitTest.getSegmentAt(coords),
    getContourEndpointAt: (coords: Coordinates) => hitTest.getContourEndpointAt(coords),
    getSelectionBoundingRect: () => hitTest.getSelectionBoundingRect(),
    getAllPoints: () => hitTest.getAllPoints(),
    getSegmentById: (id: SegmentId) => hitTest.getSegmentById(id),
    updateHover: (coords: Coordinates) => hitTest.updateHover(coords),
    getMiddlePointAt: (coords: Coordinates) => hitTest.getMiddlePointAt(coords),
    getFocusZone: () => zone.getZone(),
    get pan() {
      return viewport.getPan();
    },
    setPan: (x: number, y: number) => viewport.pan(x, y),
    get hoveredBoundingBoxHandle() {
      return $hoveredBoundingBoxHandle;
    },
    hitTestBoundingBoxAt: vi.fn((_coords: Coordinates) => null),
    getHoveredBoundingBoxHandle: () => $hoveredBoundingBoxHandle.peek(),
    get hoveredPointId() {
      return hover.hoveredPointId;
    },
    get hoveredSegmentId() {
      return hover.hoveredSegmentId;
    },
    get isHoveringNode() {
      return $isHoveringNode;
    },
    getIsHoveringNode: () => $isHoveringNode.value,
    get currentModifiers() {
      return $currentModifiers;
    },
    getCurrentModifiers: () => $currentModifiers.value,
    setCurrentModifiers: (modifiers: Modifiers) => $currentModifiers.set(modifiers),
    getSnapPreferences: () => $snapPreferences.value,
    setSnapPreferences: (next: Partial<SnapPreferences>) =>
      $snapPreferences.set({ ...$snapPreferences.value, ...next }),
    createDragSnapSession,
    createRotateSnapSession,
    duplicateSelection: vi.fn(() => []),
    setSnapIndicator: vi.fn(),
    textRunManager,
    getTextRunState: () => textRunManager.state.peek(),
    getTextRunLength: () => textRunManager.buffer.length,
    ensureTextRunSeed: (unicode: number | null) => textRunManager.ensureSeeded(unicode),
    setTextRunCursorVisible: (visible: boolean) => textRunManager.setCursorVisible(visible),
    setTextRunEditingSlot: (index: number | null, unicode?: number | null) =>
      textRunManager.setEditingSlot(index, unicode),
    resetTextRunEditingContext: () => textRunManager.resetEditingContext(),
    setTextRunHovered: (index: number | null) => textRunManager.setHovered(index),
    insertTextCodepoint: (codepoint: number) => textRunManager.buffer.insert(codepoint),
    deleteTextCodepoint: () => textRunManager.buffer.delete(),
    moveTextCursorLeft: () => textRunManager.buffer.moveLeft(),
    moveTextCursorRight: () => textRunManager.buffer.moveRight(),
    moveTextCursorToEnd: () => textRunManager.buffer.moveTo(textRunManager.buffer.length),
    recomputeTextRun: (originX?: number) => textRunManager.recompute(font, originX),
    shouldRenderEditableGlyph: () => {
      const state = textRunManager.state.peek();
      return !state || state.editingIndex !== null;
    },
    getToolState: (scope: "app" | "document", toolId: string, key: string) =>
      toolState[scope].get(`${toolId}:${key}`),
    setToolState: (scope: "app" | "document", toolId: string, key: string, value: unknown) => {
      toolState[scope].set(`${toolId}:${key}`, value);
    },
    deleteToolState: (scope: "app" | "document", toolId: string, key: string) => {
      toolState[scope].delete(`${toolId}:${key}`);
    },
    startEditSession: vi.fn((unicode: number) => {
      fontEngine.session.startEditSession(unicode);
      fontEngine.editing.addContour();
      textRunManager.recompute(font);
    }),
    getActiveGlyphUnicode: vi.fn(() => fontEngine.session.getEditingUnicode()),
    setMainGlyphUnicode: (unicode: number | null) => {
      mainGlyphUnicode = unicode;
      textRunManager.setOwnerGlyph(unicode);
      textRunManager.recompute(font);
    },
    getMainGlyphUnicode: () => mainGlyphUnicode,
    setActiveTool: vi.fn(),
    clearHover: () => hoverProxy.clearAll(),
    requestTemporaryTool: (toolId: ToolName, options?: TemporaryToolOptions) =>
      tools.requestTemporary(toolId, options),
    returnFromTemporaryTool: () => tools.returnFromTemporary(),
    mocks: {
      screen,
      selection,
      hover: hoverProxy,
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
  handleEvent(event: ToolEvent): void;
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
    const coords = makeTestCoordinates(event.upm);
    this.tool.handleEvent({
      type: "dragStart",
      point: event.upm,
      coords,
      screenPoint: event.screen,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
  }

  onMouseMove(event: ToolMouseEvent): void {
    const coords = makeTestCoordinates(event.upm);
    if (this.mouseDown && this.downPoint && this.downScreenPoint) {
      this.tool.handleEvent({
        type: "drag",
        point: event.upm,
        coords,
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
        coords,
      });
    }
  }

  onMouseUp(event: ToolMouseEvent): void {
    const coords = makeTestCoordinates(event.upm);
    if (this.mouseDown && this.downPoint && this.downScreenPoint) {
      this.tool.handleEvent({
        type: "dragEnd",
        point: event.upm,
        coords,
        screenPoint: event.screen,
        origin: this.downPoint,
        screenOrigin: this.downScreenPoint,
      });
    }
    this.mouseDown = false;
    this.downPoint = null;
    this.downScreenPoint = null;
  }

  click(x: number, y: number, options?: { shiftKey?: boolean; altKey?: boolean }): void {
    const point = { x, y };
    const coords = makeTestCoordinates(point);
    this.tool.handleEvent({
      type: "click",
      point,
      coords,
      shiftKey: options?.shiftKey ?? false,
      altKey: options?.altKey ?? false,
    });
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
