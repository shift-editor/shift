import { vi } from "vitest";
import type {
  PointId,
  ContourId,
  GlyphSnapshot,
  Point,
  Contour,
  Glyph,
  AnchorId,
  PointType,
} from "@shift/types";
import { Vec2 } from "@shift/geo";
import type {
  EditorAPI,
  ActiveToolState,
  NodePositionOperation,
  RotateDrag,
  ResizeDrag,
  TranslateDrag,
} from "@/lib/tools/core";
import type { Modifiers } from "@/lib/tools/core/GestureDetector";
import { asContourId, asPointId } from "@shift/types";
import type { ToolName } from "@/lib/tools/core";
import type { ContourEndpointHit, HitResult } from "@/types/hitResult";
import type { TemporaryToolOptions, SnapPreferences } from "@/types/editor";
import type { CommandHistory } from "@/lib/commands";
import {
  NudgePointsCommand,
  RotatePointsCommand,
  ScalePointsCommand,
  UpgradeLineToCubicCommand,
} from "@/lib/commands";
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
import type { NodePositionUpdate, NodePositionUpdateList } from "@/types/positionUpdate";
import type { ReflectAxis } from "@/types/transform";
import type { LineSegment } from "@/types/segments";
import { FontEngine, MockFontEngine } from "@/engine";
import { TextRunManager } from "@/lib/editor/managers/TextRunManager";
import { Segments as SegmentOps, type SegmentHitResult } from "@/lib/geo/Segments";
import { glyphRefFromUnicode } from "@/lib/utils/unicode";
import { getGlyphInfo } from "@/store/glyphInfo";
import { makeTestCoordinatesFromScene, makeTestCoordinatesFromGlyphLocal } from "./coordinates";

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

interface HoverService {
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

interface EditService {
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
  beginNodePositionOperation(label: string): NodePositionOperation;
  beginTranslateDrag(
    target: {
      pointIds: PointId[];
      anchorIds: AnchorId[];
    },
    startPointer: Point2D,
    label?: string,
  ): TranslateDrag;
  beginRotateDrag(
    target: {
      pointIds: PointId[];
      anchorIds: AnchorId[];
    },
    origin: Point2D,
    startPointer: Point2D,
    label?: string,
  ): RotateDrag;
  beginResizeDrag(
    target: {
      pointIds: PointId[];
      anchorIds: AnchorId[];
    },
    origin: Point2D,
    startPointer: Point2D,
    options?: { uniformScale?: boolean; label?: string },
  ): ResizeDrag;
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

interface PreviewService {
  beginPreview(): void;
  cancelPreview(): void;
  resetPreviewToStart(): void;
  commitPreview(label: string): void;
  isInPreview(): boolean;
  getPreviewSnapshot(): GlyphSnapshot | null;
}

interface TransformService {
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
  getHoveredAnchor(): AnchorId | null;
  getHoveredSegment(): SegmentIndicator | null;
  getCursorValue(): string;
  readonly screenMousePosition: Signal<Point2D>;
  setCurrentModifiers(modifiers: Modifiers): void;
  getAllPoints(): Point[];
  addPoint(x: number, y: number, type: unknown, smooth?: boolean): PointId;
  getFontMetrics(): {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    capHeight: number;
    xHeight: number;
    lineGap: number;
    italicAngle: number;
    underlinePosition: number;
    underlineThickness: number;
  };
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
    set _mode(m: SelectionMode) {
      _mode = m;
    },
    mocks,
  };
}

function createMockHoverService(): HoverService & {
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
    const activeContourId = fontEngine.getActiveContourId();
    if (!activeContourId) return null;
    return getContourById(asContourId(activeContourId));
  };

  const mocks = {
    addPoint: vi.fn((x: number, y: number, type: PointType, smooth = false) => {
      const contourId = fontEngine.getActiveContourId();
      if (!contourId) {
        throw new Error("No active contour");
      }
      return fontEngine.addPointToContour(contourId, {
        id: "" as PointId,
        x,
        y,
        pointType: type,
        smooth,
      });
    }),
    addPointToContour: vi.fn(
      (contourId: ContourId, x: number, y: number, type: PointType, smooth: boolean) =>
        fontEngine.addPointToContour(contourId, {
          id: "" as PointId,
          x,
          y,
          pointType: type,
          smooth,
        }),
    ),
    insertPointBefore: vi.fn(
      (beforePointId: PointId, x: number, y: number, type: PointType, smooth: boolean) =>
        fontEngine.insertPointBefore(beforePointId, {
          id: "" as PointId,
          x,
          y,
          pointType: type,
          smooth,
        }),
    ),
    movePoints: vi.fn((ids: Iterable<PointId>, dx: number, dy: number) =>
      fontEngine.movePoints([...ids], { x: dx, y: dy }),
    ),
    movePointTo: vi.fn((id: PointId, x: number, y: number) =>
      fontEngine.movePointTo(id, x, y),
    ),
    setNodePositions: vi.fn((updates: NodePositionUpdateList) =>
      fontEngine.setNodePositions(updates),
    ),
    beginNodePositionOperation: vi.fn((label: string): NodePositionOperation => {
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

          fontEngine.setNodePositions(updates);
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
            fontEngine.setNodePositions(restore);
          }
          closed = true;
        },
      };
    }),
    beginTranslateDrag: vi.fn(
      (
        target: { pointIds: PointId[]; anchorIds: AnchorId[] },
        startPointer: Point2D,
        label?: string,
      ): TranslateDrag => {
        void startPointer;
        void label;
        const baseGlyph = fontEngine.$glyph.value;
        if (!baseGlyph) {
          throw new Error("Cannot begin translate drag without an active glyph");
        }

        let closed = false;
        return {
          update(delta: Point2D) {
            if (closed) return;
            const updates: NodePositionUpdate[] = [];

            for (const contour of baseGlyph.contours) {
              for (const point of contour.points) {
                if (!target.pointIds.includes(point.id)) continue;
                const next = Vec2.add(point, delta);
                updates.push({ node: { kind: "point", id: point.id }, x: next.x, y: next.y });
              }
            }

            for (const anchor of baseGlyph.anchors) {
              if (!target.anchorIds.includes(anchor.id)) continue;
              const next = Vec2.add(anchor, delta);
              updates.push({ node: { kind: "anchor", id: anchor.id }, x: next.x, y: next.y });
            }

            fontEngine.setNodePositions(updates);
          },
          commit() {
            closed = true;
          },
          cancel() {
            if (closed) return;
            fontEngine.restoreSnapshot(baseGlyph);
            closed = true;
          },
        };
      },
    ),
    beginRotateDrag: vi.fn(
      (
        target: { pointIds: PointId[]; anchorIds: AnchorId[] },
        origin: Point2D,
        startPointer: Point2D,
        label?: string,
      ): RotateDrag => {
        void startPointer;
        void label;
        const baseGlyph = fontEngine.$glyph.value;
        if (!baseGlyph) {
          throw new Error("Cannot begin rotate drag without an active glyph");
        }

        let closed = false;
        return {
          update(angle: number) {
            if (closed) return;
            const updates: NodePositionUpdate[] = [];

            for (const contour of baseGlyph.contours) {
              for (const point of contour.points) {
                if (!target.pointIds.includes(point.id)) continue;
                const next = Vec2.rotateAround(point, origin, angle);
                updates.push({ node: { kind: "point", id: point.id }, x: next.x, y: next.y });
              }
            }

            for (const anchor of baseGlyph.anchors) {
              if (!target.anchorIds.includes(anchor.id)) continue;
              const next = Vec2.rotateAround(anchor, origin, angle);
              updates.push({ node: { kind: "anchor", id: anchor.id }, x: next.x, y: next.y });
            }

            fontEngine.setNodePositions(updates);
          },
          commit() {
            closed = true;
          },
          cancel() {
            if (closed) return;
            fontEngine.restoreSnapshot(baseGlyph);
            closed = true;
          },
        };
      },
    ),
    beginResizeDrag: vi.fn(
      (
        target: { pointIds: PointId[]; anchorIds: AnchorId[] },
        origin: Point2D,
        startPointer: Point2D,
        options?: { uniformScale?: boolean; label?: string },
      ): ResizeDrag => {
        void startPointer;
        void options;
        const baseGlyph = fontEngine.$glyph.value;
        if (!baseGlyph) {
          throw new Error("Cannot begin resize drag without an active glyph");
        }

        let closed = false;
        return {
          update(scaleX: number, scaleY: number) {
            if (closed) return;
            const updates: NodePositionUpdate[] = [];

            for (const contour of baseGlyph.contours) {
              for (const point of contour.points) {
                if (!target.pointIds.includes(point.id)) continue;
                const offset = Vec2.sub(point, origin);
                const next = Vec2.add(origin, { x: offset.x * scaleX, y: offset.y * scaleY });
                updates.push({ node: { kind: "point", id: point.id }, x: next.x, y: next.y });
              }
            }

            for (const anchor of baseGlyph.anchors) {
              if (!target.anchorIds.includes(anchor.id)) continue;
              const offset = Vec2.sub(anchor, origin);
              const next = Vec2.add(origin, { x: offset.x * scaleX, y: offset.y * scaleY });
              updates.push({ node: { kind: "anchor", id: anchor.id }, x: next.x, y: next.y });
            }

            fontEngine.setNodePositions(updates);
          },
          commit() {
            closed = true;
          },
          cancel() {
            if (closed) return;
            fontEngine.restoreSnapshot(baseGlyph);
            closed = true;
          },
        };
      },
    ),
    moveAnchors: vi.fn((ids: AnchorId[], dx: number, dy: number) =>
      fontEngine.moveAnchors(ids, { x: dx, y: dy }),
    ),
    applySmartEdits: vi.fn((ids: readonly PointId[], dx: number, dy: number) =>
      fontEngine.applySmartEdits(new Set(ids), dx, dy),
    ),
    removePoints: vi.fn((ids: Iterable<PointId>) => fontEngine.removePoints([...ids])),
    addContour: vi.fn(() => fontEngine.addContour()),
    closeContour: vi.fn(() => fontEngine.closeContour()),
    toggleSmooth: vi.fn((id: PointId) => fontEngine.toggleSmooth(id)),
    getActiveContourId: vi.fn(() => {
      const id = fontEngine.getActiveContourId();
      return id ? asContourId(id) : null;
    }),
    setActiveContour: vi.fn((contourId: ContourId) =>
      fontEngine.setActiveContour(contourId),
    ),
    clearActiveContour: vi.fn(() => fontEngine.clearActiveContour()),
    reverseContour: vi.fn((contourId: ContourId) => fontEngine.reverseContour(contourId)),
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
    beginNodePositionOperation: mocks.beginNodePositionOperation,
    beginTranslateDrag: mocks.beginTranslateDrag,
    beginRotateDrag: mocks.beginRotateDrag,
    beginResizeDrag: mocks.beginResizeDrag,
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
        fontEngine.restoreSnapshot(_previewSnapshot);
      }
      _previewSnapshot = null;
      _isInPreview = false;
    }),
    resetPreviewToStart: vi.fn(() => {
      if (_isInPreview && _previewSnapshot) {
        fontEngine.restoreSnapshot(_previewSnapshot);
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

  const getAnchorAt = (pos: Point2D) => {
    const snapshot = fontEngine.$glyph.value;
    if (!snapshot) return null;

    for (const anchor of snapshot.anchors) {
      const dist = Math.sqrt((anchor.x - pos.x) ** 2 + (anchor.y - pos.y) ** 2);
      if (dist < hitRadius) {
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

    const activeContourId = fontEngine.getActiveContourId();

    for (const contour of snapshot.contours) {
      if (contour.id === activeContourId || contour.closed) continue;
      if (contour.points.length < 3) continue;

      for (let i = 1; i < contour.points.length - 1; i++) {
        const point = contour.points[i];
        if (!point) continue;
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

    const anchor = getAnchorAt(pos);
    if (anchor) return { type: "anchor", anchorId: anchor.id };

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

function createMockCommandHistory(
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

export function createMockToolContext(): MockToolContext {
  const fontEngine = new FontEngine(new MockFontEngine());
  const glyphInfo = getGlyphInfo();
  const glyphNameResolverDeps = {
    getExistingGlyphNameForUnicode: (unicode: number) => fontEngine.getGlyphNameForUnicode(unicode),
    getMappedGlyphName: (unicode: number) => glyphInfo.getGlyphName(unicode),
  };
  fontEngine.startEditSession({ glyphName: "A", unicode: 65 });
  fontEngine.addContour();

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
  textRunManager.setOwnerGlyph({
    glyphName: fontEngine.getGlyphNameForUnicode(mainGlyphUnicode) ?? "A",
    unicode: mainGlyphUnicode,
  });

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
    () =>
      hover.hoveredPointId.value !== null ||
      hover.hoveredAnchorId.value !== null ||
      hover.hoveredSegmentId.value !== null,
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
    getSelectedAnchors: () => [...selection.getSelectedAnchors()],
    getSelectedSegments: () => [...selection.getSelectedSegments()],
    getHoveredPoint: () => hover.getHoveredPoint(),
    getHoveredAnchor: () => hover.getHoveredAnchor(),
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
    getMousePosition: () => {
      const point = $screenMousePosition.peek();
      return screen.projectScreenToScene(point.x, point.y);
    },
    getScreenMousePosition: () => $screenMousePosition.peek(),
    flushMousePosition: () => {},
    projectScreenToScene: (screenOrX: Point2D | number, y?: number) => {
      const screenPoint = typeof screenOrX === "number" ? { x: screenOrX, y: y ?? 0 } : screenOrX;
      return screen.projectScreenToScene(screenPoint.x, screenPoint.y);
    },
    projectSceneToScreen: (sceneOrX: Point2D | number, y?: number) => {
      const scenePoint = typeof sceneOrX === "number" ? { x: sceneOrX, y: y ?? 0 } : sceneOrX;
      return screen.projectSceneToScreen(scenePoint.x, scenePoint.y);
    },
    sceneToGlyphLocal: (point: Point2D) => ({
      x: point.x - drawOffset.x,
      y: point.y - drawOffset.y,
    }),
    glyphLocalToScene: (point: Point2D) => ({
      x: point.x + drawOffset.x,
      y: point.y + drawOffset.y,
    }),
    fromScreen: (screenOrX: Point2D | number, y?: number) => {
      const screenPoint = typeof screenOrX === "number" ? { x: screenOrX, y: y ?? 0 } : screenOrX;
      return makeTestCoordinatesFromScene(
        screen.projectScreenToScene(screenPoint.x, screenPoint.y),
        drawOffset,
        screenPoint,
      );
    },
    fromScene: (sceneOrX: Point2D | number, y?: number) => {
      const scenePoint = typeof sceneOrX === "number" ? { x: sceneOrX, y: y ?? 0 } : sceneOrX;
      return makeTestCoordinatesFromScene(scenePoint, drawOffset);
    },
    fromGlyphLocal: (glyphLocalOrX: Point2D | number, y?: number) => {
      const glyphLocal =
        typeof glyphLocalOrX === "number" ? { x: glyphLocalOrX, y: y ?? 0 } : glyphLocalOrX;
      return makeTestCoordinatesFromGlyphLocal(glyphLocal, drawOffset);
    },
    screenToUpmDistance: (pixels: number) => pixels,
    hasSelection: () => selection.hasSelection(),
    getActiveToolState: () => $activeToolState.value,
    setActiveToolState: (state: ActiveToolState) => {
      $activeToolState.value = state;
    },
    selectPoints: (ids: readonly PointId[]) => selection.selectPoints(ids),
    selectAnchors: (ids: readonly AnchorId[]) => selection.selectAnchors(ids),
    clearSelection: () => selection.clear(),
    setSelectionMode: (mode: SelectionMode) => selection.setMode(mode),
    getSelectionMode: () => selection.getMode(),
    addPointToSelection: (id: PointId) => selection.addPoint(id),
    addAnchorToSelection: (id: AnchorId) => selection.addAnchor(id),
    removePointFromSelection: (id: PointId) => selection.removePoint(id),
    removeAnchorFromSelection: (id: AnchorId) => selection.removeAnchor(id),
    togglePointSelection: (id: PointId) => selection.togglePoint(id),
    toggleAnchorSelection: (id: AnchorId) => selection.toggleAnchor(id),
    isPointSelected: (id: PointId) => selection.isPointSelected(id),
    isAnchorSelected: (id: AnchorId) => selection.isAnchorSelected(id),
    selectSegments: (ids: readonly SegmentId[]) => selection.selectSegments(ids),
    addSegmentToSelection: (id: SegmentId) => selection.addSegment(id),
    removeSegmentFromSelection: (id: SegmentId) => selection.removeSegment(id),
    toggleSegmentInSelection: (id: SegmentId) => selection.toggleSegment(id),
    isSegmentSelected: (id: SegmentId) => selection.isSegmentSelected(id),
    glyph: computed<Glyph | null>(() => edit.getGlyph() as Glyph | null),
    font,
    addPoint: (x: number, y: number, type: PointType, smooth = false) =>
      edit.addPoint(x, y, type, smooth),
    addContour: () => edit.addContour(),
    addPointToContour: (contourId: ContourId, position: Point2D, type: PointType, smooth = false) =>
      edit.addPointToContour(contourId, position.x, position.y, type, smooth),
    insertPointBefore: (
      beforePointId: PointId,
      position: Point2D,
      type: PointType,
      smooth = false,
    ) => edit.insertPointBefore(beforePointId, position.x, position.y, type, smooth),
    closeContour: () => edit.closeContour(),
    movePointTo: (id: PointId, position: Point2D) => edit.movePointTo(id, position.x, position.y),
    setNodePositions: (updates: NodePositionUpdateList) => edit.setNodePositions(updates),
    createDraft: () => {
      const base = fontEngine.$glyph.peek()!;
      return {
        base,
        setPositions: (_updates: NodePositionUpdateList) => {
          fontEngine.emitGlyph(base);
        },
        finish: (_label: string) => {
          fontEngine.syncNodePositions([]);
        },
        discard: () => {
          fontEngine.emitGlyph(base);
        },
      };
    },
    splitSegment: vi.fn(() => "" as PointId),
    continueContour: (contourId: ContourId, fromStart: boolean, pointId: PointId) => {
      edit.setActiveContour(contourId);
      if (fromStart) {
        edit.reverseContour(contourId);
      }
      selection.selectPoints([pointId]);
    },
    scalePoints: (pointIds: readonly PointId[], sx: number, sy: number, anchor: Point2D) => {
      if (pointIds.length === 0) return;
      if (sx === 1 && sy === 1) return;
      commands.execute(new ScalePointsCommand([...pointIds], sx, sy, anchor));
    },
    rotatePoints: (pointIds: readonly PointId[], angle: number, center: Point2D) => {
      if (pointIds.length === 0) return;
      if (angle === 0) return;
      commands.execute(new RotatePointsCommand([...pointIds], angle, center));
    },
    nudgePoints: (pointIds: readonly PointId[], dx: number, dy: number) => {
      if (pointIds.length === 0) return;
      if (dx === 0 && dy === 0) return;
      commands.execute(new NudgePointsCommand([...pointIds], dx, dy));
    },
    upgradeLineToCubic: (segment: LineSegment) => {
      commands.execute(new UpgradeLineToCubicCommand(segment));
    },
    moveAnchors: (ids: AnchorId[], delta: Point2D) => edit.moveAnchors(ids, delta.x, delta.y),
    toggleSmooth: (id: PointId) => edit.toggleSmooth(id),
    getActiveContourId: () => edit.getActiveContourId(),
    getActiveContour: () => edit.getActiveContour(),
    setActiveContour: (id: ContourId) => edit.setActiveContour(id),
    clearActiveContour: () => edit.clearActiveContour(),
    reverseContour: (id: ContourId) => edit.reverseContour(id),
    beginPreview: () => preview.beginPreview(),
    cancelPreview: () => preview.cancelPreview(),
    commitPreview: (label: string) => preview.commitPreview(label),
    withBatch: <TResult>(label: string, fn: () => TResult): TResult =>
      commands.withBatch(label, fn) as TResult,
    withPreview: <TResult>(label: string, fn: () => TResult): TResult => {
      preview.beginPreview();
      try {
        const result = fn();
        preview.commitPreview(label);
        return result;
      } catch (err) {
        preview.cancelPreview();
        throw err;
      }
    },
    requestRedraw: () => render.requestRedraw(),
    requestStaticRedraw: () => render.requestStaticRedraw(),
    isPreviewMode: () => render.isPreviewMode(),
    setPreviewMode: (enabled: boolean) => render.setPreviewMode(enabled),
    setHandlesVisible: (visible: boolean) => render.setHandlesVisible(visible),
    setMarqueePreviewRect: (_rect: Rect2D | null) => {},
    isPointInMarqueePreview: (_pointId: PointId) => false,
    getNodeAt: (coords: Coordinates) => hitTest.getNodeAt(coords),
    getAnchorAt: (coords: Coordinates) => hitTest.getAnchorAt(coords),
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
    setPan: (panOrX: Point2D | number, y?: number) => {
      const pan = typeof panOrX === "number" ? { x: panOrX, y: y ?? 0 } : panOrX;
      viewport.pan(pan.x, pan.y);
    },
    get hoveredBoundingBoxHandle() {
      return $hoveredBoundingBoxHandle;
    },
    hitTestBoundingBoxAt: vi.fn((_coords: Coordinates) => null),
    getHoveredBoundingBoxHandle: () => $hoveredBoundingBoxHandle.peek(),
    get hoveredPointId() {
      return hover.hoveredPointId;
    },
    get hoveredAnchorId() {
      return hover.hoveredAnchorId;
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
    ensureTextRunSeed: (glyph: { glyphName: string; unicode: number | null } | null) =>
      textRunManager.ensureSeeded(glyph),
    setTextRunCursorVisible: (visible: boolean) => textRunManager.setCursorVisible(visible),
    setTextRunEditingSlot: (
      index: number | null,
      glyph?: { glyphName: string; unicode: number | null } | null,
    ) => textRunManager.setEditingSlot(index, glyph),
    resetTextRunEditingContext: () => textRunManager.resetEditingContext(),
    setTextRunHovered: (index: number | null) => textRunManager.setHovered(index),
    setTextRunInspectionSlot: (index: number | null) => textRunManager.setInspectionSlot(index),
    setTextRunInspectionComponent: (index: number | null) =>
      textRunManager.setInspectionHoveredComponent(index),
    clearTextRunInspection: () => textRunManager.clearInspection(),
    insertTextCodepoint: (codepoint: number) => {
      textRunManager.buffer.insert(glyphRefFromUnicode(codepoint, glyphNameResolverDeps));
    },
    insertTextGlyphAt: (index: number, glyph: { glyphName: string; unicode: number | null }) =>
      textRunManager.insertGlyphAt(index, glyph),
    getTextRunCodepoints: () =>
      textRunManager.buffer
        .getText()
        .map((glyph) => glyph.unicode)
        .filter((unicode): unicode is number => unicode !== null),
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
    startEditSession: vi.fn((glyph: { glyphName: string; unicode: number | null }) => {
      fontEngine.startEditSession(glyph);
      fontEngine.addContour();
      textRunManager.recompute(font);
    }),
    getActiveGlyphUnicode: vi.fn(() => fontEngine.getEditingUnicode()),
    getActiveGlyphName: vi.fn(() => fontEngine.getEditingGlyphName()),
    setMainGlyphUnicode: (unicode: number | null) => {
      mainGlyphUnicode = unicode;
      const glyphRef =
        unicode === null ? null : glyphRefFromUnicode(unicode, glyphNameResolverDeps);
      textRunManager.setOwnerGlyph(glyphRef);
      textRunManager.recompute(font);
    },
    getMainGlyphUnicode: () => mainGlyphUnicode,
    getGlyphCompositeComponents: vi.fn((_glyphName: string) => null),
    setActiveTool: vi.fn(),
    clearHover: () => hoverProxy.clearAll(),
    setDrawOffsetForGlyph: (
      offset: Point2D,
      _glyph: { glyphName: string; unicode: number | null } | null,
    ) => {
      drawOffset = { x: offset.x, y: offset.y };
    },
    requestTemporaryTool: (toolId: ToolName, options?: TemporaryToolOptions) =>
      tools.requestTemporary(toolId, options),
    returnFromTemporaryTool: () => tools.returnFromTemporary(),
    getFontMetrics: vi.fn(() => ({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
      italicAngle: 0,
      underlinePosition: -100,
      underlineThickness: 50,
    })),
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
