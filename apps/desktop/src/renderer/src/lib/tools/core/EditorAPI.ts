/**
 * Editor sub-interfaces — interface-sliced surface for tools.
 *
 * The API is decomposed into focused sub-interfaces (Viewport, Selection,
 * HitTesting, Snapping, Editing, Commands, ToolLifecycle, TextRunAccess,
 * VisualState). Each sub-interface groups a single responsibility.
 * Tools and behaviors receive the concrete {@link Editor} class directly.
 *
 * Notes for dead-code tooling:
 * members in this contract are often used through interface slices and
 * manager wiring. Implementations may need explicit `@knipclassignore`
 * comments on concrete class members when usage is indirect.
 *
 * @module
 */
import type { Point2D, PointId, ContourId, Point, Contour, Rect2D, AnchorId } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { SelectionMode, SnapPreferences } from "@/types/editor";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { FocusZone } from "@/types/focus";
import type { ToolName } from "./createContext";
import type { ActiveToolState } from "./ToolStateMap";
import type { TemporaryToolOptions } from "@/types/editor";
import type { CommandHistory } from "@/lib/commands";
import type { Signal } from "@/lib/reactive/signal";
import type { LineSegment, Segment } from "@/types/segments";
import type { HitResult } from "@/types/hitResult";
import type { Modifiers } from "./GestureDetector";
import type {
  DragSnapSessionConfig,
  DragSnapSession,
  RotateSnapSession,
  SnapIndicator,
} from "@/lib/editor/snapping/types";
import type { TextRunController } from "@/lib/tools/text/TextRunController";
import type { Coordinates } from "@/types/coordinates";
import type { GlyphRef } from "../text/layout";
import type { CompositeGlyph } from "@shift/types";
import type { GlyphDraft } from "@/types/draft";

export interface DragTarget {
  pointIds: PointId[];
  anchorIds: AnchorId[];
}

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
  projectScreenToScene(screen: Point2D): Point2D;
  /** Convert scene (UPM) coordinates to screen pixels. */
  projectSceneToScreen(scene: Point2D): Point2D;
  /** Convert a scene point into glyph-local coordinates using the current draw offset. */
  sceneToGlyphLocal(point: Point2D): Point2D;
  /** Convert a glyph-local point into scene coordinates using the current draw offset. */
  glyphLocalToScene(point: Point2D): Point2D;
  /** Build Coordinates from a screen position. */
  fromScreen(screen: Point2D): Coordinates;
  /** Build Coordinates from a scene (UPM) position. */
  fromScene(scene: Point2D): Coordinates;
  /** Build Coordinates from a glyph-local position. */
  fromGlyphLocal(glyphLocal: Point2D): Coordinates;
  screenToUpmDistance(pixels: number): number;
  /** Hit-test radius in UPM units, derived from a fixed pixel radius and current zoom. */
  readonly hitRadius: number;
  readonly pan: Point2D;
  setPan(pan: Point2D): void;
}

/**
 * Point and segment selection management.
 *
 * Provides read/write access to the current selection set. Tools use this
 * to query what the user has selected and to mutate the selection in response
 * to clicks, marquee drags, and keyboard shortcuts.
 */
export interface SelectionAccess {
  getSelectedPoints(): PointId[];
  getSelectedSegments(): SegmentId[];
  hasSelection(): boolean;
  isPointSelected(id: PointId): boolean;
  isAnchorSelected(id: AnchorId): boolean;
  isSegmentSelected(id: SegmentId): boolean;
  selectPoints(ids: readonly PointId[]): void;
  selectAnchors(ids: readonly AnchorId[]): void;
  clearSelection(): void;
  setSelectionMode(mode: SelectionMode): void;
  addPointToSelection(id: PointId): void;
  addAnchorToSelection(id: AnchorId): void;
  removePointFromSelection(id: PointId): void;
  removeAnchorFromSelection(id: AnchorId): void;
  togglePointSelection(id: PointId): void;
  toggleAnchorSelection(id: AnchorId): void;
  getSelectedAnchors(): AnchorId[];
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
  hitTest(coords: Coordinates): HitResult;
  getSegmentById(segmentId: SegmentId): Segment | null;
  getAllPoints(): Point[];
  getSelectionBoundingRect(): Rect2D | null;
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
 * Higher-level editing operations that involve command history, selection,
 * or multi-step logic. Low-level point/contour mutations are on the Glyph
 * model directly (accessed via `editor.glyph`).
 */
export interface Editing {
  splitSegment(segment: Segment, t: number): PointId;
  continueContour(contourId: ContourId, fromStart: boolean, pointId: PointId): void;
  createDraft(): GlyphDraft;
  scalePoints(pointIds: readonly PointId[], sx: number, sy: number, anchor: Point2D): void;
  rotatePoints(pointIds: readonly PointId[], angle: number, center: Point2D): void;
  nudgePoints(pointIds: readonly PointId[], dx: number, dy: number): void;
  upgradeLineToCubic(segment: LineSegment): void;
  duplicateSelection(): PointId[];
  /** The contour currently being extended by the Pen tool, or null. */
  getActiveContour(): Contour | null;
  getActiveContourId(): ContourId | null;
  /** Open a glyph for editing by canonical glyph reference. */
  open(glyph: GlyphRef): void;
  /** Return the unicode codepoint of the glyph currently being edited, or null. */
  getActiveGlyphUnicode(): number | null;
  /** Return the glyph name currently being edited, or null. */
  getActiveGlyphName(): string | null;
  /** Set/get the main glyph selected from the grid/route. */
  setMainGlyphUnicode(unicode: number | null): void;
  getMainGlyphUnicode(): number | null;
}

/**
 * Text-run access.
 */
export interface TextRunAccess {
  readonly textRunController: TextRunController;
  /** Insert a glyph by unicode codepoint (resolves name via font engine). */
  insertTextCodepoint(codepoint: number): void;
  /** Composite component data for a glyph (font engine query). */
  getGlyphCompositeComponents(glyphName: string): CompositeGlyph | null;
}

export type ToolStateScope = "app" | "document";

/**
 * Tool-scoped persisted state access.
 *
 * Keys are namespaced by `toolId` and persisted by scope.
 */
export interface ToolStateStore {
  getToolState(scope: ToolStateScope, toolId: string, key: string): unknown;
  setToolState(scope: ToolStateScope, toolId: string, key: string, value: unknown): void;
  deleteToolState(scope: ToolStateScope, toolId: string, key: string): void;
}

/**
 * Undo/redo command stack.
 */
export interface Commands {
  readonly commands: CommandHistory;
  /** Execute `fn` as a single undoable command batch. */
  withBatch<TResult>(label: string, fn: () => TResult): TResult;
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
  /** Set draw offset and apply editor-only glyph placement adjustments for the target glyph. */
  setDrawOffsetForGlyph(offset: Point2D, glyph: GlyphRef | null): void;
  requestStaticRedraw(): void;
  requestRedraw(): void;
  updateHover(coords: Coordinates): void;
  clearHover(): void;
  readonly hoveredBoundingBoxHandle: Signal<BoundingBoxHitResult>;
  getHoveredBoundingBoxHandle(): BoundingBoxHitResult;
  readonly hoveredPointId: Signal<PointId | null>;
  readonly hoveredAnchorId: Signal<AnchorId | null>;
  readonly hoveredSegmentId: Signal<SegmentIndicator | null>;
  readonly isHoveringNode: Signal<boolean>;
  getIsHoveringNode(): boolean;
  setHandlesVisible(visible: boolean): void;
  isPreviewMode(): boolean;
  setPreviewMode(enabled: boolean): void;
  /** Set or clear the marquee rectangle (UPM space). Points inside are highlighted as a selection preview. */
  setMarqueePreviewRect(rect: Rect2D | null): void;
  isPointInMarqueePreview(pointId: PointId): boolean;
  /** Switch to a different tool by name. */
  setActiveTool(toolName: ToolName): void;
}
