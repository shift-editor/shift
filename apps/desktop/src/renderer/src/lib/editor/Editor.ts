import type { IGraphicContext, IRenderer } from "@/types/graphics";
import type { HandleState, HandleType } from "./rendering/handles";
import type {
  CursorType,
  SelectionMode,
  ToolRegistryItem,
  VisualState,
  RenderState,
} from "@/types/editor";
import type {
  Point2D,
  Rect2D,
  PointId,
  ContourId,
  GlyphSnapshot,
  PointSnapshot,
  ContourSnapshot,
} from "@shift/types";
import { asContourId, asPointId } from "@shift/types";
import { findPointInSnapshot } from "../utils/snapshot";
import { createContext, type ToolContext, type ToolName } from "../tools/core";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import { ToolManager, type ToolConstructor } from "../tools/core/ToolManager";
import { SnapshotCommand } from "../commands/primitives/SnapshotCommand";
import { Segment as SegmentOps, type SegmentHitResult } from "../geo/Segment";
import { Polygon, Vec2 } from "@shift/geo";

import { drawHandle } from "./rendering/handles";
import { ViewportManager } from "./managers";
import { FontEngine } from "@/engine";
import { CommandHistory, PasteCommand } from "../commands";
import {
  RotatePointsCommand,
  ScalePointsCommand,
  ReflectPointsCommand,
  MoveSelectionToCommand,
  AlignPointsCommand,
  DistributePointsCommand,
  getSegmentAwareBounds,
  type ReflectAxis,
  type SelectionBounds,
  type AlignmentType,
  type DistributeType,
} from "../transform";
import {
  computed,
  effect,
  signal,
  type ComputedSignal,
  type Effect,
  type Signal,
  type WritableSignal,
} from "../reactive/signal";
import { ClipboardManager } from "../clipboard";
import { cursorToCSS } from "../styles/cursor";
import { SelectionManager, HoverManager } from "./managers";
import { GlyphRenderer } from "./rendering/GlyphRenderer";
import { SCREEN_HIT_RADIUS } from "./rendering/constants";

export class Editor {
  private $previewMode: WritableSignal<boolean>;

  #selection: SelectionManager;
  #hover: HoverManager;
  #renderer: GlyphRenderer;

  #toolManager: ToolManager | null = null;
  #toolMetadata: Map<
    ToolName,
    { icon: React.FC<React.SVGProps<SVGSVGElement>>; tooltip: string }
  >;
  private $activeTool: WritableSignal<ToolName>;

  #viewport: ViewportManager;
  #commandHistory: CommandHistory;
  #fontEngine: FontEngine;
  #redrawEffect: Effect;
  #clipboardManager: ClipboardManager;
  #context: ToolContext | null = null;

  #previewSnapshot: GlyphSnapshot | null = null;
  #isInPreview: boolean = false;

  $renderState: ComputedSignal<RenderState>;
  private $cursor: WritableSignal<string>;

  constructor() {
    this.#viewport = new ViewportManager();
    this.#fontEngine = new FontEngine();
    this.#commandHistory = new CommandHistory(
      this.#fontEngine,
      () => this.#fontEngine.$glyph.value,
    );

    this.$previewMode = signal(false);
    this.$cursor = signal("default");

    this.#selection = new SelectionManager();
    this.#hover = new HoverManager();

    this.#toolMetadata = new Map();
    this.$activeTool = signal<ToolName>("select");

    this.#renderer = new GlyphRenderer({
      viewport: this.#viewport,
      getSnapshot: () => this.#fontEngine.$glyph.value,
      getFontMetrics: () => this.#fontEngine.info.getMetrics(),
      renderTool: (ctx) => this.#toolManager?.render(ctx),
      selection: this.#selection,
      hover: this.#hover,
      getPreviewMode: () => this.previewMode.peek(),
      getHandleState: (pointId) => this.getHandleState(pointId),
      paintHandle: (ctx, x, y, handleType, state, segmentAngle) =>
        this.paintHandle(ctx, x, y, handleType, state, segmentAngle),
      getSelectedPointData: () => this.#getSelectedPointData(),
    });

    this.#clipboardManager = new ClipboardManager({
      getSnapshot: () => this.#fontEngine.$glyph.value,
      getSelectedPointIds: () => this.#selection.selectedPointIds.peek(),
      getSelectedSegmentIds: () => this.#selection.selectedSegmentIds.peek(),
      getGlyphName: () => this.#fontEngine.$glyph.value?.name,
      pasteContours: (json, x, y) =>
        this.#fontEngine.editing.pasteContours(json, x, y),
      selectPoints: (ids) => this.selectPoints(ids),
    });

    this.$renderState = computed<RenderState>(() => ({
      glyph: this.#fontEngine.$glyph.value,
      selectedPointIds: this.#selection.selectedPointIds.value,
      selectedSegmentIds: this.#selection.selectedSegmentIds.value,
      hoveredPointId: this.#hover.hoveredPointId.value,
      hoveredSegmentId: this.#hover.hoveredSegmentId.value,
      selectionMode: this.#selection.selectionMode.value,
      previewMode: this.$previewMode.value,
    }));

    this.#redrawEffect = effect(() => {
      this.$renderState.value;
      this.requestRedraw();
    });
  }

  public registerTool(
    name: ToolName,
    ToolClass: ToolConstructor,
    icon: React.FC<React.SVGProps<SVGSVGElement>>,
    tooltip: string,
  ): void {
    this.#toolMetadata.set(name, { icon, tooltip });
    this.getToolManager().register(name, ToolClass);
  }

  public get tools(): ReadonlyMap<ToolName, ToolRegistryItem> {
    const result = new Map<ToolName, ToolRegistryItem>();
    for (const [name, metadata] of this.#toolMetadata) {
      result.set(name, {
        icon: metadata.icon,
        tooltip: metadata.tooltip,
      });
    }
    return result;
  }

  public get activeTool(): Signal<ToolName> {
    return this.$activeTool;
  }

  public setActiveTool(toolName: ToolName): void {
    const currentToolName = this.$activeTool.value;
    if (currentToolName === toolName) return;

    this.getToolManager().activate(toolName);
    this.$activeTool.set(toolName);
  }

  public getToolManager(): ToolManager {
    if (!this.#toolManager) {
      this.#toolManager = new ToolManager(this.getContext());
    }
    return this.#toolManager;
  }

  public getContext(): ToolContext {
    if (!this.#context) {
      this.#context = createContext(this);
    }
    return this.#context;
  }

  public get selectedPointIds(): Signal<ReadonlySet<PointId>> {
    return this.#selection.selectedPointIds;
  }

  public selectPoints(pointIds: Set<PointId>): void {
    this.#selection.selectPoints(pointIds);
  }

  public addPointToSelection(pointId: PointId): void {
    this.#selection.addPointToSelection(pointId);
  }

  public removePointFromSelection(pointId: PointId): void {
    this.#selection.removePointFromSelection(pointId);
  }

  public togglePointSelection(pointId: PointId): void {
    this.#selection.togglePointSelection(pointId);
  }

  public isPointSelected(pointId: PointId): boolean {
    return this.#selection.isPointSelected(pointId);
  }

  public get selectedSegmentIds(): Signal<ReadonlySet<SegmentId>> {
    return this.#selection.selectedSegmentIds;
  }

  public selectSegments(segmentIds: Set<SegmentId>): void {
    this.#selection.selectSegments(segmentIds);
  }

  public addSegmentToSelection(segmentId: SegmentId): void {
    this.#selection.addSegmentToSelection(segmentId);
  }

  public removeSegmentFromSelection(segmentId: SegmentId): void {
    this.#selection.removeSegmentFromSelection(segmentId);
  }

  public toggleSegmentInSelection(segmentId: SegmentId): void {
    this.#selection.toggleSegmentInSelection(segmentId);
  }

  public isSegmentSelected(segmentId: SegmentId): boolean {
    return this.#selection.isSegmentSelected(segmentId);
  }

  public clearSelection(): void {
    this.#selection.clearSelection();
  }

  public hasSelection(): boolean {
    return this.#selection.hasSelection();
  }

  public get selectionMode(): Signal<SelectionMode> {
    return this.#selection.selectionMode;
  }

  public setSelectionMode(mode: "preview" | "committed"): void {
    this.#selection.setSelectionMode(mode);
  }

  public get hoveredPointId(): Signal<PointId | null> {
    return this.#hover.hoveredPointId;
  }

  public get hoveredSegmentId(): Signal<SegmentIndicator | null> {
    return this.#hover.hoveredSegmentId;
  }

  public setHoveredPoint(pointId: PointId | null): void {
    this.#hover.setHoveredPoint(pointId);
  }

  public setHoveredSegment(indicator: SegmentIndicator | null): void {
    this.#hover.setHoveredSegment(indicator);
  }

  public clearHover(): void {
    this.#hover.clearHover();
  }

  public getPointVisualState(pointId: PointId): VisualState {
    return this.#hover.getPointVisualState(pointId, (id) =>
      this.#selection.isPointSelected(id),
    );
  }

  public getSegmentVisualState(segmentId: SegmentId): VisualState {
    return this.#hover.getSegmentVisualState(segmentId, (id) =>
      this.#selection.isSegmentSelected(id),
    );
  }

  public get previewMode(): Signal<boolean> {
    return this.$previewMode;
  }

  public setPreviewMode(enabled: boolean): void {
    this.$previewMode.set(enabled);
  }

  public setStaticContext(context: IGraphicContext) {
    this.#renderer.setStaticContext(context);
  }

  public setInteractiveContext(context: IGraphicContext) {
    this.#renderer.setInteractiveContext(context);
  }

  public startEditSession(unicode: number): void {
    this.#fontEngine.session.startEditSession(unicode);
    this.#fontEngine.editing.addContour();
  }

  public endEditSession(): void {
    this.#fontEngine.session.endEditSession();
  }

  public getSnapshot(): GlyphSnapshot | null {
    return this.#fontEngine.$glyph.value;
  }

  public get commandHistory(): CommandHistory {
    return this.#commandHistory;
  }

  public get viewportManager(): ViewportManager {
    return this.#viewport;
  }

  public get fontEngine(): FontEngine {
    return this.#fontEngine;
  }

  public get selectionManager(): SelectionManager {
    return this.#selection;
  }

  public get hoverManager(): HoverManager {
    return this.#hover;
  }

  public get isInPreview(): boolean {
    return this.#isInPreview;
  }

  public get previewSnapshot(): GlyphSnapshot | null {
    return this.#previewSnapshot;
  }

  public undo() {
    this.#commandHistory.undo();
    this.requestRedraw();
  }

  public redo() {
    this.#commandHistory.redo();
    this.requestRedraw();
  }

  public setViewportRect(rect: Rect2D) {
    this.#viewport.setRect(rect);
  }

  public setViewportUpm(upm: number) {
    this.#viewport.upm = upm;
  }

  public updateMetricsFromFont(): void {
    const metrics = this.#fontEngine.info.getMetrics();
    this.#viewport.upm = metrics.unitsPerEm;
    this.#viewport.descender = metrics.descender;
    this.requestRedraw();
  }

  public getMousePosition(x?: number, y?: number): Point2D {
    if (x === undefined || y === undefined) {
      return this.#viewport.getMousePosition();
    }

    return this.#viewport.getMousePosition(x, y);
  }

  public getUpmMousePosition(): Point2D {
    return this.#viewport.getUpmMousePosition();
  }

  public projectScreenToUpm(x: number, y: number): Point2D {
    return this.#viewport.projectScreenToUpm(x, y);
  }

  public setUpmMousePosition(x: number, y: number) {
    this.#viewport.setUpmMousePosition(x, y);
  }

  public pan(dx: number, dy: number) {
    this.#viewport.pan(dx, dy);
  }

  public getPan(): Point2D {
    return { x: this.#viewport.panX, y: this.#viewport.panY };
  }

  public zoomIn(): void {
    this.#viewport.zoomIn();
  }

  public zoomOut(): void {
    this.#viewport.zoomOut();
  }

  public zoomToPoint(
    screenX: number,
    screenY: number,
    zoomDelta: number,
  ): void {
    this.#viewport.zoomToPoint(screenX, screenY, zoomDelta);
  }

  public getHandleState(pointId: PointId): HandleState {
    return this.getPointVisualState(pointId);
  }

  public paintHandle(
    ctx: IRenderer,
    x: number,
    y: number,
    handleType: Exclude<HandleType, "last">,
    state: HandleState,
    segmentAngle?: number,
  ) {
    drawHandle(ctx, handleType, x, y, state, { segmentAngle });
  }

  public getFontMetrics() {
    return this.#fontEngine.info.getMetrics();
  }

  public getFontMetadata() {
    return this.#fontEngine.info.getMetadata();
  }

  public loadFont(filePath: string): void {
    if (this.#fontEngine.session.isActive()) {
      this.#fontEngine.session.endEditSession();
    }
    this.#fontEngine.io.loadFont(filePath);
    this.#commandHistory.clear();
    this.startEditSession(65);
  }

  public saveFont(filePath: string): void {
    this.#fontEngine.io.saveFont(filePath);
  }

  public get cursor(): Signal<string> {
    return this.$cursor;
  }

  public setCursor(cursor: CursorType): void {
    this.$cursor.set(cursorToCSS(cursor));
  }

  public get zoom(): Signal<number> {
    return this.#viewport.zoom;
  }

  public deleteSelectedPoints(): void {
    const selectedIds = this.#selection.selectedPointIds.peek();
    if (selectedIds.size > 0) {
      this.#fontEngine.editing.removePoints([...selectedIds]);
      this.clearSelection();
      this.requestRedraw();
    }
  }

  public async copy(): Promise<boolean> {
    return this.#clipboardManager.copy();
  }

  public async cut(): Promise<boolean> {
    const copied = await this.#clipboardManager.cut();
    if (copied) {
      this.deleteSelectedPoints();
    }
    return copied;
  }

  public async paste(): Promise<void> {
    const content = this.#clipboardManager.getInternalClipboard();
    if (!content) {
      const result = await this.#clipboardManager.paste();
      if (result?.success) {
        this.requestRedraw();
      }
      return;
    }

    const cmd = new PasteCommand(content, 0, 0);
    this.#commandHistory.execute(cmd);
    this.selectPoints(new Set(cmd.createdPointIds));
    this.requestRedraw();
  }

  public beginPreview(): void {
    if (this.#isInPreview) return;
    this.#previewSnapshot = this.#fontEngine.$glyph.value;
    this.#isInPreview = true;
  }

  public cancelPreview(): void {
    if (!this.#isInPreview || !this.#previewSnapshot) return;

    this.#fontEngine.editing.restoreSnapshot(this.#previewSnapshot);
    this.#previewSnapshot = null;
    this.#isInPreview = false;
    this.requestRedraw();
  }

  public commitPreview(label: string): void {
    if (!this.#isInPreview || !this.#previewSnapshot) return;

    const before = this.#previewSnapshot;
    const after = this.#fontEngine.$glyph.value;

    if (before && after) {
      const cmd = new SnapshotCommand(label, before, after);
      this.#commandHistory.record(cmd);
    }

    this.#previewSnapshot = null;
    this.#isInPreview = false;
  }

  /**
   * Get the bounding box and center of the current selection.
   * Returns null if no points are selected.
   * Uses segment-aware bounds for curves (includes extrema, not just anchor points).
   */
  public getSelectionBounds(): SelectionBounds | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;
    return getSegmentAwareBounds(
      snapshot,
      this.#selection.selectedPointIds.peek(),
    );
  }

  /**
   * Get the center of the current selection's bounding box.
   * Returns null if no points are selected.
   */
  public getSelectionCenter(): Point2D | null {
    const bounds = this.getSelectionBounds();
    return bounds?.center ?? null;
  }

  /**
   * Rotate selected points.
   * @param angle - Rotation in radians (positive = counter-clockwise)
   * @param origin - Optional origin point; defaults to selection center
   */
  public rotateSelection(angle: number, origin?: Point2D): void {
    const pointIds = [...this.#selection.selectedPointIds.peek()];
    if (pointIds.length === 0) return;

    const center = origin ?? this.getSelectionCenter();
    if (!center) return;

    const cmd = new RotatePointsCommand(pointIds, angle, center);
    this.#commandHistory.execute(cmd);
  }

  public scaleSelection(sx: number, sy: number, origin?: Point2D): void {
    const pointIds = [...this.#selection.selectedPointIds.peek()];
    if (pointIds.length === 0) return;

    const o = origin ?? this.getSelectionCenter();
    if (!o) return;

    const cmd = new ScalePointsCommand(pointIds, sx, sy, o);
    this.#commandHistory.execute(cmd);
  }

  public reflectSelection(axis: ReflectAxis, origin?: Point2D): void {
    const pointIds = [...this.#selection.selectedPointIds.peek()];
    if (pointIds.length === 0) return;

    const center = origin ?? this.getSelectionCenter();
    if (!center) return;

    const cmd = new ReflectPointsCommand(pointIds, axis, center);
    this.#commandHistory.execute(cmd);
  }

  public moveSelectionTo(target: Point2D, anchor: Point2D): void {
    const pointIds = [...this.#selection.selectedPointIds.peek()];
    if (pointIds.length === 0) return;

    const cmd = new MoveSelectionToCommand(pointIds, target, anchor);
    this.#commandHistory.execute(cmd);
  }

  public alignSelection(alignment: AlignmentType): void {
    const pointIds = [...this.#selection.selectedPointIds.peek()];
    if (pointIds.length === 0) return;

    const cmd = new AlignPointsCommand(pointIds, alignment);
    this.#commandHistory.execute(cmd);
  }

  public distributeSelection(type: DistributeType): void {
    const pointIds = [...this.#selection.selectedPointIds.peek()];
    if (pointIds.length < 3) return;

    const cmd = new DistributePointsCommand(pointIds, type);
    this.#commandHistory.execute(cmd);
  }

  public findPoint(pointId: PointId): PointSnapshot | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;

    const result = findPointInSnapshot(snapshot, pointId);
    return result?.point ?? null;
  }

  public getPointAt(pos: Point2D): PointSnapshot | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;

    const hitRadius = this.#viewport.screenToUpmDistance(SCREEN_HIT_RADIUS);

    for (const contour of snapshot.contours) {
      for (const point of contour.points) {
        if (Vec2.dist(point, pos) < hitRadius) {
          return point;
        }
      }
    }
    return null;
  }

  public getPointIdAt(pos: Point2D): PointId | null {
    const point = this.getPointAt(pos);
    return point ? asPointId(point.id) : null;
  }

  public getSegmentAt(pos: Point2D): SegmentHitResult | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;

    const hitRadius = this.#viewport.screenToUpmDistance(SCREEN_HIT_RADIUS);

    for (const contour of snapshot.contours) {
      const segments = SegmentOps.parse(contour.points, contour.closed);
      const hit = SegmentOps.hitTestMultiple(segments, pos, hitRadius);
      if (hit) {
        return hit;
      }
    }
    return null;
  }

  public getContourEndpointAt(pos: Point2D): {
    contourId: ContourId;
    position: "start" | "end";
    contour: ContourSnapshot;
    pointId: PointId;
  } | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;

    const hitRadius = this.#viewport.screenToUpmDistance(SCREEN_HIT_RADIUS);

    for (const contour of snapshot.contours) {
      if (contour.closed || contour.points.length === 0) continue;

      const firstPoint = contour.points[0];
      const lastPoint = contour.points[contour.points.length - 1];

      if (Vec2.dist(firstPoint, pos) < hitRadius) {
        return {
          contourId: asContourId(contour.id),
          pointId: asPointId(firstPoint.id),
          position: "start",
          contour,
        };
      }

      if (Vec2.dist(lastPoint, pos) < hitRadius) {
        return {
          contourId: asContourId(contour.id),
          pointId: asPointId(lastPoint.id),
          position: "end",
          contour,
        };
      }
    }
    return null;
  }

  public getSelectionBoundingRect(): Rect2D | null {
    const selectedPoints = this.#selection.selectedPointIds.peek();
    if (selectedPoints.size === 0) return null;

    const mode = this.#selection.selectionMode.peek();
    if (mode !== "committed") return null;

    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;

    const points: PointSnapshot[] = [];
    for (const contour of snapshot.contours) {
      for (const point of contour.points) {
        if (selectedPoints.has(asPointId(point.id))) {
          points.push(point);
        }
      }
    }

    return Polygon.boundingRect(points);
  }

  public updateHover(pos: Point2D): void {
    const pointId = this.getPointIdAt(pos);
    if (pointId) {
      this.#hover.setHoveredPoint(pointId);
      return;
    }

    const segmentHit = this.getSegmentAt(pos);
    if (segmentHit) {
      this.#hover.setHoveredSegment({
        segmentId: segmentHit.segmentId,
        closestPoint: segmentHit.point,
        t: segmentHit.t,
      });
      return;
    }

    this.#hover.clearHover();
  }

  public getAllPoints(): PointSnapshot[] {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return [];

    const result: PointSnapshot[] = [];
    for (const contour of snapshot.contours) {
      result.push(...contour.points);
    }
    return result;
  }

  public findSegmentById(segmentId: SegmentId) {
    const snapshot = this.#fontEngine.$glyph.value;
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
  }

  #getSelectedPointData(): Array<{ x: number; y: number }> {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return [];

    const result: Array<{ x: number; y: number }> = [];
    for (const pointId of this.#selection.selectedPointIds.peek()) {
      const found = findPointInSnapshot(snapshot, pointId);
      if (found) {
        result.push({ x: found.point.x, y: found.point.y });
      }
    }
    return result;
  }

  public requestRedraw() {
    this.#renderer.requestRedraw();
  }

  public requestImmediateRedraw() {
    this.#renderer.requestImmediateRedraw();
  }

  public cancelRedraw() {
    this.#renderer.cancelRedraw();
  }

  public destroy() {
    this.#redrawEffect.dispose();
    this.#renderer.destroy();
  }
}
