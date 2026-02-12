/**
 * Editor API — interface-sliced surface for tools.
 *
 * Instead of handing every tool a monolithic Editor reference, the API is
 * decomposed into 8 focused sub-interfaces (Viewport, Selection, HitTesting,
 * Snapping, Editing, Commands, ToolLifecycle, VisualState). Each sub-interface
 * groups a single responsibility so that behaviors and tools only depend on the
 * slice they actually use, while the composite {@link EditorAPI} type provides
 * the full surface when needed.
 *
 * The composite type also exposes `font` ({@link Font}) and `glyph`
 * (reactive signal) directly, since nearly every tool requires them.
 *
 * @module
 */
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
import type { Segment } from "@/types/segments";
import type { HitResult } from "@/types/hitResult";
import type { Modifiers } from "./GestureDetector";
import type {
  DragSnapSessionConfig,
  DragSnapSession,
  RotateSnapSession,
  SnapIndicator,
} from "@/lib/editor/snapping/types";
import type { Font } from "@/lib/editor/Font";
import type { TextRunManager } from "@/lib/editor/managers/TextRunManager";
import type { Coordinates } from "@/types/coordinates";

/**
 * Coordinate-space conversions and viewport state.
 *
 * All drawing happens in UPM space; this interface bridges screen pixels to
 * UPM units and exposes the current pan offset and hit-test radius.
 */
export interface Viewport {
  getMousePosition(): Point2D;
  getScreenMousePosition(): Point2D;
  /** Force an immediate position update (used before hit-testing during drags). */
  flushMousePosition?(): void;
  /** Convert screen pixels to scene (UPM) coordinates. */
  projectScreenToScene(x: number, y: number): Point2D;
  /** Convert a scene point into glyph-local coordinates using the current draw offset. */
  sceneToGlyphLocal(point: Point2D): Point2D;
  /** Convert a glyph-local point into scene coordinates using the current draw offset. */
  glyphLocalToScene(point: Point2D): Point2D;
  /** Build Coordinates from a screen position. */
  fromScreen(sx: number, sy: number): Coordinates;
  /** Build Coordinates from a scene (UPM) position. */
  fromScene(x: number, y: number): Coordinates;
  /** Build Coordinates from a glyph-local position. */
  fromGlyphLocal(x: number, y: number): Coordinates;
  screenToUpmDistance(pixels: number): number;
  /** Hit-test radius in UPM units, derived from a fixed pixel radius and current zoom. */
  readonly hitRadius: number;
  readonly pan: Point2D;
  setPan(x: number, y: number): void;
}

/**
 * Point and segment selection management.
 *
 * Provides read/write access to the current selection set. Tools use this
 * to query what the user has selected and to mutate the selection in response
 * to clicks, marquee drags, and keyboard shortcuts.
 */
export interface Selection {
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

/**
 * Spatial queries against the current glyph.
 *
 * Hit-test methods accept {@link Coordinates}; the implementation uses the
 * scene position. Methods return typed hit results that callers can
 * discriminate via {@link HitResult}.
 */
export interface HitTesting {
  /** Return the highest-priority hit at the given position (point > segment > endpoint). */
  getNodeAt(coords: Coordinates): HitResult;
  getPointAt(coords: Coordinates): Point | null;
  getSegmentAt(coords: Coordinates): SegmentHitResult | null;
  getSegmentById(segmentId: SegmentId): Segment | null;
  getAllPoints(): Point[];
  getContourEndpointAt(coords: Coordinates): ContourEndpointHit | null;
  getMiddlePointAt(coords: Coordinates): MiddlePointHit | null;
  getSelectionBoundingRect(): Rect2D | null;
  /** Hit-test the bounding box resize/rotate handles (not the glyph points). */
  hitTestBoundingBoxAt(coords: Coordinates): BoundingBoxHitResult;
}

/**
 * Snap session lifecycle and snap preferences.
 *
 * Tools create short-lived snap sessions (drag or rotate) that compute snap
 * candidates on each frame. The resulting indicator is pushed to the editor
 * for overlay rendering.
 */
export interface Snapping {
  getSnapPreferences(): SnapPreferences;
  setSnapPreferences(next: Partial<SnapPreferences>): void;
  createDragSnapSession(config: DragSnapSessionConfig): DragSnapSession;
  createRotateSnapSession(): RotateSnapSession;
  setSnapIndicator(indicator: SnapIndicator | null): void;
}

/**
 * Glyph mutation operations.
 *
 * Low-level editing primitives that modify point positions, toggle smoothness,
 * and manage the "active contour" (the contour currently being drawn by the Pen tool).
 */
export interface Editing {
  movePointTo(id: PointId, x: number, y: number): void;
  /** Translate points by a delta, adjusting adjacent off-curve handles to preserve tangent continuity. Returns all affected IDs (including handles). */
  applySmartEdits(ids: readonly PointId[], dx: number, dy: number): PointId[];
  setPointPositions(moves: Array<{ id: PointId; x: number; y: number }>): void;
  toggleSmooth(id: PointId): void;
  duplicateSelection(): PointId[];
  /** The contour currently being extended by the Pen tool, or null. */
  getActiveContour(): Contour | null;
  getActiveContourId(): ContourId | null;
  clearActiveContour(): void;
  setActiveContour(id: ContourId): void;
  /** Open a glyph for editing by its Unicode codepoint. */
  startEditSession(unicode: number): void;
  /** Return the unicode codepoint of the glyph currently being edited, or null. */
  getActiveGlyphUnicode(): number | null;
}

/**
 * Undo/redo command stack and preview transaction management.
 *
 * Preview transactions let tools apply speculative edits (e.g. during a drag)
 * that can be committed as a single undoable command or discarded on cancel.
 */
export interface Commands {
  readonly commands: CommandHistory;
  /**
   * Start a preview transaction. Subsequent edits are tentative and rendered
   * live but not yet on the undo stack. Must be paired with {@link commitPreview}
   * or {@link cancelPreview}.
   */
  beginPreview(): void;
  /** Commit the preview as a single undoable command. */
  commitPreview(label: string): void;
  /** Discard all edits since {@link beginPreview}, restoring the prior state. */
  cancelPreview(): void;
}

/**
 * Tool switching, temporary tool stack, and modifier key tracking.
 *
 * Supports the "temporary tool" pattern where holding a key (e.g. Space for
 * Hand) pushes a tool onto a stack and pops it on release.
 */
export interface ToolLifecycle {
  readonly activeToolState: Signal<ActiveToolState>;
  getActiveToolState(): ActiveToolState;
  setActiveToolState(state: ActiveToolState): void;
  requestTemporaryTool(toolId: ToolName, options?: TemporaryToolOptions): void;
  returnFromTemporaryTool(): void;
  readonly currentModifiers: Signal<Modifiers>;
  getCurrentModifiers(): Modifiers;
  setCurrentModifiers?(modifiers: Modifiers): void;
  /** Return the current focus zone. Tools use this to avoid consuming key events when a sidebar input has focus. */
  getFocusZone(): FocusZone;
}

/**
 * Visual feedback state: hover highlights, draw offset, preview mode, marquee.
 *
 * Controls what decorations the renderer draws on the overlay canvas (hover
 * outlines, marquee rectangle, bounding box handles) and whether the glyph
 * is shown in filled preview mode or editable outline mode.
 */
export interface VisualState {
  /** Cumulative translation offset applied during drag operations (UPM space). Reset to zero on drag end. */
  getDrawOffset(): Point2D;
  setDrawOffset(offset: Point2D): void;
  requestStaticRedraw(): void;
  requestRedraw(): void;
  updateHover(coords: Coordinates): void;
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
  /** Set or clear the marquee rectangle (UPM space). Points inside are highlighted as a selection preview. */
  setMarqueePreviewRect(rect: Rect2D | null): void;
  isPointInMarqueePreview(pointId: PointId): boolean;
  /** The persistent text run manager, owned by the editor. */
  readonly textRunManager: TextRunManager;
  /** Switch to a different tool by name. */
  setActiveTool(toolName: ToolName): void;
}

/**
 * Full editor surface available to tools — the intersection of all 8
 * sub-interfaces plus the font and reactive glyph signal.
 */
export type EditorAPI = Viewport &
  Selection &
  HitTesting &
  Snapping &
  Editing &
  Commands &
  ToolLifecycle &
  VisualState & {
    readonly font: Font;
    readonly glyph: Signal<Glyph | null>;
  };
