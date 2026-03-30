import { vi } from "vitest";
import type {
  PointId,
  ContourId,
  GlyphSnapshot,
  Point,
  Contour,
  AnchorId,
  PointType,
} from "@shift/types";
import { asContourId, asPointId } from "@shift/types";
import type { InteractionSession } from "@/lib/tools/core";
import type { SelectionMode, CursorType } from "@/types/editor";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { Point2D } from "@shift/types";
import { signal, type WritableSignal } from "@/lib/reactive/signal";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { Coordinates } from "@/types/coordinates";
import type { NodePositionUpdate, NodePositionUpdateList } from "@/types/positionUpdate";
import { FontEngine } from "@/engine";
import { Segments as SegmentOps, type SegmentHitResult } from "@/lib/geo/Segments";
import type { CommandHistory } from "@/lib/commands";
import type {
  CursorService,
  EditService,
  HitTestService,
  HoverService,
  PreviewService,
  RenderService,
  ScreenService,
  SelectionService,
  TransformService,
  ViewportService,
} from "./types";

function distance(a: Point2D, b: Point2D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function createMockScreenService(): ScreenService & {
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

export function createMockSelectionService(): SelectionService & {
  _selectedPoints: Set<PointId>;
  _selectedAnchors: Set<AnchorId>;
  _selectedSegments: Set<SegmentId>;
  _mode: SelectionMode;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const _selectedPoints = new Set<PointId>();
  const _selectedAnchors = new Set<AnchorId>();
  const _selectedSegments = new Set<SegmentId>();
  let _mode: SelectionMode = "committed";
  const $selectedPoints: WritableSignal<ReadonlySet<PointId>> = signal<ReadonlySet<PointId>>(
    new Set(),
  );
  const $selectedAnchors: WritableSignal<ReadonlySet<AnchorId>> = signal<ReadonlySet<AnchorId>>(
    new Set(),
  );
  const $selectedSegments: WritableSignal<ReadonlySet<SegmentId>> = signal<ReadonlySet<SegmentId>>(
    new Set(),
  );
  const $mode: WritableSignal<SelectionMode> = signal<SelectionMode>("committed");

  const updateSignals = () => {
    $selectedPoints.set(new Set(_selectedPoints));
    $selectedAnchors.set(new Set(_selectedAnchors));
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
    selectAnchors: vi.fn((ids: readonly AnchorId[]) => {
      _selectedAnchors.clear();
      for (const id of ids) _selectedAnchors.add(id);
      updateSignals();
    }),
    addAnchor: vi.fn((id: AnchorId) => {
      _selectedAnchors.add(id);
      updateSignals();
    }),
    removeAnchor: vi.fn((id: AnchorId) => {
      _selectedAnchors.delete(id);
      updateSignals();
    }),
    toggleAnchor: vi.fn((id: AnchorId) => {
      if (_selectedAnchors.has(id)) {
        _selectedAnchors.delete(id);
      } else {
        _selectedAnchors.add(id);
      }
      updateSignals();
    }),
    isAnchorSelected: vi.fn((id: AnchorId) => _selectedAnchors.has(id)),
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
      _selectedAnchors.clear();
      _selectedSegments.clear();
      updateSignals();
    }),
    hasSelection: vi.fn(
      () => _selectedPoints.size > 0 || _selectedAnchors.size > 0 || _selectedSegments.size > 0,
    ),
    setMode: vi.fn((mode: SelectionMode) => {
      _mode = mode;
      updateSignals();
    }),
  };

  return {
    getSelectedPoints: () => [..._selectedPoints] as readonly PointId[],
    getSelectedAnchors: () => [..._selectedAnchors] as readonly AnchorId[],
    getSelectedSegments: () => [..._selectedSegments] as readonly SegmentId[],
    getSelectedPointsCount: () => _selectedPoints.size,
    getSelectedAnchorsCount: () => _selectedAnchors.size,
    getSelectedSegmentsCount: () => _selectedSegments.size,
    getMode: () => _mode,
    selectPoints: mocks.selectPoints,
    selectAnchors: mocks.selectAnchors,
    addPoint: mocks.addPoint,
    addAnchor: mocks.addAnchor,
    removePoint: mocks.removePoint,
    removeAnchor: mocks.removeAnchor,
    togglePoint: mocks.togglePoint,
    toggleAnchor: mocks.toggleAnchor,
    isPointSelected: mocks.isPointSelected,
    isAnchorSelected: mocks.isAnchorSelected,
    selectSegments: mocks.selectSegments,
    addSegment: mocks.addSegment,
    removeSegment: mocks.removeSegment,
    toggleSegment: mocks.toggleSegment,
    isSegmentSelected: mocks.isSegmentSelected,
    clear: mocks.clear,
    hasSelection: mocks.hasSelection,
    setMode: mocks.setMode,
    _selectedPoints,
    _selectedAnchors,
    _selectedSegments,
    get _mode() {
      return _mode;
    },
    set _mode(mode: SelectionMode) {
      _mode = mode;
    },
    mocks,
  };
}

export function createMockHoverService(): HoverService & {
  _hoveredPoint: PointId | null;
  _hoveredAnchor: AnchorId | null;
  _hoveredSegment: SegmentIndicator | null;
  _hoveredBoundingBoxHandle: BoundingBoxHitResult;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  let _hoveredPoint: PointId | null = null;
  let _hoveredAnchor: AnchorId | null = null;
  let _hoveredSegment: SegmentIndicator | null = null;
  let _hoveredBoundingBoxHandle: BoundingBoxHitResult = null;
  const $hoveredPoint: WritableSignal<PointId | null> = signal<PointId | null>(null);
  const $hoveredAnchor: WritableSignal<AnchorId | null> = signal<AnchorId | null>(null);
  const $hoveredSegment: WritableSignal<SegmentIndicator | null> = signal<SegmentIndicator | null>(
    null,
  );

  const mocks = {
    setHoveredPoint: vi.fn((id: PointId | null) => {
      _hoveredPoint = id;
      if (id !== null) {
        _hoveredAnchor = null;
        _hoveredSegment = null;
      }
      $hoveredPoint.set(id);
      $hoveredAnchor.set(_hoveredAnchor);
      $hoveredSegment.set(_hoveredSegment);
    }),
    setHoveredAnchor: vi.fn((id: AnchorId | null) => {
      _hoveredAnchor = id;
      if (id !== null) {
        _hoveredPoint = null;
        _hoveredSegment = null;
      }
      $hoveredAnchor.set(id);
      $hoveredPoint.set(_hoveredPoint);
      $hoveredSegment.set(_hoveredSegment);
    }),
    setHoveredSegment: vi.fn((indicator: SegmentIndicator | null) => {
      _hoveredSegment = indicator;
      if (indicator !== null) {
        _hoveredPoint = null;
        _hoveredAnchor = null;
      }
      $hoveredSegment.set(indicator);
      $hoveredPoint.set(_hoveredPoint);
      $hoveredAnchor.set(_hoveredAnchor);
    }),
    setHoveredBoundingBoxHandle: vi.fn((handle: BoundingBoxHitResult) => {
      _hoveredBoundingBoxHandle = handle;
    }),
    clearAll: vi.fn(() => {
      _hoveredPoint = null;
      _hoveredAnchor = null;
      _hoveredSegment = null;
      _hoveredBoundingBoxHandle = null;
      $hoveredPoint.set(null);
      $hoveredAnchor.set(null);
      $hoveredSegment.set(null);
    }),
  };

  return {
    getHoveredPoint: () => _hoveredPoint,
    getHoveredAnchor: () => _hoveredAnchor,
    getHoveredSegment: () => _hoveredSegment,
    getHoveredBoundingBoxHandle: () => _hoveredBoundingBoxHandle,
    setHoveredPoint: mocks.setHoveredPoint,
    setHoveredAnchor: mocks.setHoveredAnchor,
    setHoveredSegment: mocks.setHoveredSegment,
    setHoveredBoundingBoxHandle: mocks.setHoveredBoundingBoxHandle,
    clearAll: mocks.clearAll,
    get _hoveredPoint() {
      return _hoveredPoint;
    },
    get _hoveredAnchor() {
      return _hoveredAnchor;
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
    get hoveredAnchorId() {
      return $hoveredAnchor;
    },
    get hoveredSegmentId() {
      return $hoveredSegment;
    },
    mocks,
  };
}

export function createMockEditService(
  fontEngine: FontEngine,
): EditService & { mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const getPointById = (pointId: PointId): Point | null => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    for (const contour of snapshot.contours) {
      const point = contour.points.find((item) => item.id === pointId);
      if (point) return point as Point;
    }
    return null;
  };

  const getContourById = (contourId: ContourId): Contour | null => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    const contour = snapshot.contours.find((item) => item.id === contourId);
    return contour ? (contour as Contour) : null;
  };

  const getActiveContour = (): Contour | null => {
    const activeContourId = fontEngine.editing.getActiveContourId();
    if (!activeContourId) return null;
    return getContourById(asContourId(activeContourId));
  };

  const mocks = {
    addPoint: vi.fn((x: number, y: number, type: PointType, smooth = false) => {
      const contourId = fontEngine.editing.getActiveContourId();
      if (!contourId) {
        throw new Error("No active contour");
      }
      return fontEngine.editing.addPointToContour(contourId, {
        id: "" as PointId,
        x,
        y,
        pointType: type,
        smooth,
      });
    }),
    addPointToContour: vi.fn(
      (contourId: ContourId, x: number, y: number, type: PointType, smooth: boolean) =>
        fontEngine.editing.addPointToContour(contourId, {
          id: "" as PointId,
          x,
          y,
          pointType: type,
          smooth,
        }),
    ),
    insertPointBefore: vi.fn(
      (beforePointId: PointId, x: number, y: number, type: PointType, smooth: boolean) =>
        fontEngine.editing.insertPointBefore(beforePointId, {
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
    setNodePositions: vi.fn((updates: NodePositionUpdateList) =>
      fontEngine.editing.setNodePositions(updates),
    ),
    beginInteractionSession: vi.fn((label: string): InteractionSession => {
      const touched = new Map<
        string,
        { node: NodePositionUpdate["node"]; before: Point2D; after: Point2D }
      >();
      let closed = false;

      const keyFor = (node: NodePositionUpdate["node"]) => `${node.kind}:${node.id}`;
      const readPos = (node: NodePositionUpdate["node"]): Point2D | null => {
        const glyph = fontEngine.$glyph.value;
        if (!glyph) return null;
        if (node.kind === "point") {
          for (const contour of glyph.contours) {
            const point = contour.points.find((item) => item.id === node.id);
            if (point) return { x: point.x, y: point.y };
          }
          return null;
        }
        if (node.kind === "anchor") {
          const anchor = glyph.anchors.find((item) => item.id === node.id);
          return anchor ? { x: anchor.x, y: anchor.y } : null;
        }
        return null;
      };

      const hasChanges = (): boolean =>
        [...touched.values()].some(
          (entry) => entry.before.x !== entry.after.x || entry.before.y !== entry.after.y,
        );

      return {
        apply(updates: NodePositionUpdateList) {
          if (closed || updates.length === 0) return;

          for (const update of updates) {
            const key = keyFor(update.node);
            let entry = touched.get(key);
            if (!entry) {
              const before = readPos(update.node) ?? { x: update.x, y: update.y };
              entry = { node: update.node, before, after: before };
              touched.set(key, entry);
            }
            entry.after = { x: update.x, y: update.y };
          }

          fontEngine.editing.setNodePositions(updates);
        },
        hasChanges,
        commit() {
          if (closed) return;
          void label;
          closed = true;
        },
        cancel() {
          if (closed) return;
          const restore = [...touched.values()]
            .filter((entry) => entry.before.x !== entry.after.x || entry.before.y !== entry.after.y)
            .map((entry) => ({
              node: entry.node,
              x: entry.before.x,
              y: entry.before.y,
            }));
          if (restore.length > 0) {
            fontEngine.editing.setNodePositions(restore);
          }
          closed = true;
        },
      };
    }),
    moveAnchors: vi.fn((ids: AnchorId[], dx: number, dy: number) =>
      fontEngine.editing.moveAnchors(ids, { x: dx, y: dy }),
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
    insertPointBefore: mocks.insertPointBefore,
    movePoints: mocks.movePoints,
    movePointTo: mocks.movePointTo,
    setNodePositions: mocks.setNodePositions,
    beginInteractionSession: mocks.beginInteractionSession,
    moveAnchors: mocks.moveAnchors,
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

export function createMockPreviewService(fontEngine: FontEngine): PreviewService & {
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
    resetPreviewToStart: vi.fn(() => {
      if (_isInPreview && _previewSnapshot) {
        fontEngine.editing.restoreSnapshot(_previewSnapshot);
      }
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
    resetPreviewToStart: mocks.resetPreviewToStart,
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

export function createMockTransformService(): TransformService & {
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

export function createMockCursorService(): CursorService & {
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

export function createMockRenderService(): RenderService & {
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

export function createMockViewportService(): ViewportService & {
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

export function createMockHitTestService(
  fontEngine: FontEngine,
): HitTestService & { mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const hitRadius = 8;

  const getPointAt = (pos: Point2D) => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    for (const contour of snapshot.contours) {
      for (const point of contour.points) {
        if (distance(point, pos) < hitRadius) {
          return point;
        }
      }
    }
    return null;
  };

  const getAnchorAt = (pos: Point2D) => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    for (const anchor of snapshot.anchors) {
      if (distance(anchor, pos) < hitRadius) {
        return anchor as { id: AnchorId; name: string | null; x: number; y: number };
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
      if (!firstPoint || !lastPoint) continue;

      if (distance(firstPoint, pos) < hitRadius) {
        return {
          type: "contourEndpoint" as const,
          contourId: asContourId(contour.id),
          pointId: asPointId(firstPoint.id),
          position: "start" as const,
          contour,
        };
      }

      if (distance(lastPoint, pos) < hitRadius) {
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

    const result: Point[] = [];
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
        if (!point) continue;
        if (distance(point, pos) < hitRadius) {
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

  const getNodeAt = (coords: Coordinates) => {
    const pos = coords.scene;
    const endpoint = getContourEndpointAt(pos);
    if (endpoint) return endpoint;

    const middle = getMiddlePointAt(pos);
    if (middle) return middle;

    const anchor = getAnchorAt(pos);
    if (anchor) return { type: "anchor" as const, anchorId: anchor.id };

    const point = getPointAt(pos);
    if (point) return { type: "point" as const, point, pointId: point.id };

    const segmentHit = getSegmentAt(pos);
    if (segmentHit) {
      return {
        type: "segment" as const,
        segment: segmentHit.segment,
        segmentId: segmentHit.segmentId,
        t: segmentHit.t,
        closestPoint: segmentHit.point,
      };
    }

    return null;
  };

  const getPointAtCoords = (coords: Coordinates) => getPointAt(coords.scene);
  const getAnchorAtCoords = (coords: Coordinates) => getAnchorAt(coords.scene);
  const getSegmentAtCoords = (coords: Coordinates) => getSegmentAt(coords.scene);
  const getContourEndpointAtCoords = (coords: Coordinates) => getContourEndpointAt(coords.scene);
  const getMiddlePointAtCoords = (coords: Coordinates) => getMiddlePointAt(coords.scene);

  const mocks = {
    getNodeAt: vi.fn(getNodeAt),
    getAnchorAt: vi.fn(getAnchorAtCoords),
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
    getAnchorAt: mocks.getAnchorAt,
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

export function createMockCommandHistory(
  fontEngine: FontEngine,
): CommandHistory & { mocks: Record<string, ReturnType<typeof vi.fn>> } {
  let _isBatching = false;

  const mocks = {
    execute: vi.fn((cmd: { execute?: (ctx: unknown) => unknown }) =>
      cmd.execute?.({
        fontEngine,
        glyph: fontEngine.$glyph.value,
      }),
    ),
    record: vi.fn(),
    beginBatch: vi.fn((_name?: string) => {
      _isBatching = true;
    }),
    endBatch: vi.fn(() => {
      _isBatching = false;
    }),
    cancelBatch: vi.fn(() => {
      _isBatching = false;
    }),
    withBatch: vi.fn((name: string, fn: () => unknown) => {
      mocks.beginBatch(name);
      try {
        const result = fn();
        mocks.endBatch();
        return result;
      } catch (err) {
        mocks.cancelBatch();
        throw err;
      }
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
    withBatch: mocks.withBatch,
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
