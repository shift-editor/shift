import type { IGraphicContext } from "@/types/graphics";
import type { HandleState } from "./rendering/handles";
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
  Glyph,
  Contour,
  Point,
} from "@shift/types";
import { findContourInSnapshot } from "../utils/snapshot";
import { findPointInSnapshot } from "../utils/snapshot";
import type { ToolName } from "../tools/core";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import { ToolManager, type ToolConstructor } from "../tools/core/ToolManager";
import { SnapshotCommand } from "../commands/primitives/SnapshotCommand";
import { Segment as SegmentOps, type SegmentHitResult } from "../geo/Segment";
import { Polygon, Vec2 } from "@shift/geo";
import type { BoundingBoxHitResult } from "@/types/boundingBox";

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
import { SelectionManager, HoverManager, EdgePanManager } from "./managers";
import { GlyphRenderer } from "./rendering/GlyphRenderer";
import { SCREEN_HIT_RADIUS } from "./rendering/constants";
import type { FocusZone } from "@/types/focus";
import {
  SelectionService,
  HoverService,
  EditService,
  ScreenService,
  ViewportService,
  PreviewService,
  TransformService,
  HitTestService,
  CursorService,
  RenderService,
  ZoneService,
  ToolsService,
} from "./services";

export class Editor {
  private $previewMode: WritableSignal<boolean>;
  private $handlesVisible: WritableSignal<boolean>;

  #selection: SelectionManager;
  #hover: HoverManager;
  #renderer: GlyphRenderer;
  #edgePan: EdgePanManager;

  #toolManager: ToolManager | null = null;
  #toolMetadata: Map<ToolName, { icon: React.FC<React.SVGProps<SVGSVGElement>>; tooltip: string }>;
  private $activeTool: WritableSignal<ToolName>;

  #viewport: ViewportManager;
  #commandHistory: CommandHistory;
  #fontEngine: FontEngine;
  #redrawEffect: Effect;
  #clipboardManager: ClipboardManager;

  #previewSnapshot: GlyphSnapshot | null = null;
  #isInPreview: boolean = false;
  #zone: FocusZone = "canvas";

  $renderState: ComputedSignal<RenderState>;
  private $cursor: WritableSignal<string>;

  readonly selection: SelectionService;
  readonly hover: HoverService;
  readonly edit: EditService;
  readonly screen: ScreenService;
  readonly viewport: ViewportService;
  readonly preview: PreviewService;
  readonly transform: TransformService;
  readonly hitTest: HitTestService;
  readonly cursor: CursorService;
  readonly render: RenderService;
  readonly zone: ZoneService;
  readonly tools: ToolsService;

  constructor() {
    this.#viewport = new ViewportManager();
    this.#fontEngine = new FontEngine();
    this.#commandHistory = new CommandHistory(
      this.#fontEngine,
      () => this.#fontEngine.$glyph.value,
    );

    this.$previewMode = signal(false);
    this.$cursor = signal("default");
    this.$handlesVisible = signal(true);

    this.#selection = new SelectionManager();
    this.#hover = new HoverManager();
    this.#edgePan = new EdgePanManager(this);

    this.#toolMetadata = new Map();
    this.$activeTool = signal<ToolName>("select");

    this.#renderer = new GlyphRenderer(this, (ctx) => this.#toolManager?.render(ctx));

    this.#clipboardManager = new ClipboardManager(this);

    this.selection = new SelectionService(this.#selection);
    this.hover = new HoverService(this.#hover);
    this.edit = new EditService({
      fontEngine: this.#fontEngine,
      getGlyph: () => this.getGlyph(),
      getPointById: (id) => this.getPointById(id),
      getContourById: (id) => this.getContourById(id),
    });
    this.screen = new ScreenService(this.#viewport);
    this.viewport = new ViewportService(this.#viewport);
    this.preview = new PreviewService({
      beginPreview: () => this.beginPreview(),
      cancelPreview: () => this.cancelPreview(),
      commitPreview: (label) => this.commitPreview(label),
      isInPreview: () => this.isInPreview,
      getPreviewSnapshot: () => this.previewSnapshot,
    });
    this.transform = new TransformService({
      rotateSelection: (angle, origin) => this.rotateSelection(angle, origin),
      scaleSelection: (sx, sy, origin) => this.scaleSelection(sx, sy, origin),
      reflectSelection: (axis, origin) => this.reflectSelection(axis, origin),
      getSelectionBounds: () => this.getSelectionBounds(),
      getSelectionCenter: () => this.getSelectionCenter(),
    });
    this.hitTest = new HitTestService({
      getPointAt: (pos) => this.getPointAt(pos),
      getSegmentAt: (pos) => this.getSegmentAt(pos),
      getContourEndpointAt: (pos) => this.getContourEndpointAt(pos),
      getSelectionBoundingRect: () => this.getSelectionBoundingRect(),
      getAllPoints: () => this.getAllPoints(),
      getSegmentById: (id) => this.getSegmentById(id),
      updateHover: (pos) => this.updateHover(pos),
    });
    this.cursor = new CursorService(this.$cursor, (c) => this.setCursor(c));
    this.render = new RenderService({
      requestRedraw: () => this.requestRedraw(),
      requestImmediateRedraw: () => this.requestImmediateRedraw(),
      cancelRedraw: () => this.cancelRedraw(),
      setPreviewMode: (enabled) => this.setPreviewMode(enabled),
      setHandlesVisible: (visible) => this.setHandlesVisible(visible),
    });
    this.zone = new ZoneService({
      getZone: () => this.focusZone,
    });
    this.tools = new ToolsService();

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

  public get toolRegistry(): ReadonlyMap<ToolName, ToolRegistryItem> {
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
      this.#toolManager = new ToolManager(this);
    }
    return this.#toolManager;
  }

  public get selectedPointIds(): Signal<ReadonlySet<PointId>> {
    return this.#selection.selectedPointIds;
  }

  public selectPoints(pointIds: readonly PointId[]): void {
    this.#selection.selectPoints(new Set(pointIds));
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

  public selectSegments(segmentIds: readonly SegmentId[]): void {
    this.#selection.selectSegments(new Set(segmentIds));
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

  public selectAll(): void {
    const points = this.getAllPoints();
    this.#selection.selectPoints(new Set(points.map((p) => p.id)));
    this.getToolManager().notifySelectionChanged();
    this.requestRedraw();
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

  public setHoveredBoundingBoxHandle(handle: BoundingBoxHitResult): void {
    this.#hover.setHoveredBoundingBoxHandle(handle);
  }

  public getHoveredBoundingBoxHandle(): BoundingBoxHitResult {
    return this.#hover.getHoveredBoundingBoxHandle();
  }

  public clearHover(): void {
    this.#hover.clearHover();
  }

  public getPointVisualState(pointId: PointId): VisualState {
    return this.#hover.getPointVisualState(pointId, (id) => this.#selection.isPointSelected(id));
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

  public get handlesVisible(): Signal<boolean> {
    return this.$handlesVisible;
  }

  public setHandlesVisible(visible: boolean): void {
    this.$handlesVisible.set(visible);
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

  public get glyph() {
    return this.#fontEngine.$glyph;
  }

  public getGlyph(): Glyph | null {
    return this.#fontEngine.$glyph.value as Glyph | null;
  }

  public get commandHistory(): CommandHistory {
    return this.#commandHistory;
  }

  public get commands(): CommandHistory {
    return this.#commandHistory;
  }

  public get viewportManager(): ViewportManager {
    return this.#viewport;
  }

  /**
   * Direct access to the font engine for advanced operations.
   * Prefer using ToolContext.edit for standard editing.
   */
  public get fontEngine(): FontEngine {
    return this.#fontEngine;
  }

  public get selectionManager(): SelectionManager {
    return this.#selection;
  }

  public get hoverManager(): HoverManager {
    return this.#hover;
  }

  public get edgePanManager(): EdgePanManager {
    return this.#edgePan;
  }

  public updateEdgePan(screenPos: Point2D, canvasBounds: Rect2D): void {
    this.#edgePan.update(screenPos, canvasBounds);
  }

  public stopEdgePan(): void {
    this.#edgePan.stop();
  }

  public get focusZone(): FocusZone {
    return this.#zone;
  }

  public setZone(zone: FocusZone): void {
    this.#zone = zone;
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

  public zoomToPoint(screenX: number, screenY: number, zoomDelta: number): void {
    this.#viewport.zoomToPoint(screenX, screenY, zoomDelta);
  }

  public getHandleState(pointId: PointId): HandleState {
    return this.getPointVisualState(pointId);
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
    this.selectPoints(cmd.createdPointIds);
    this.requestRedraw();
  }

  /**
   * Begins a preview session. Changes made after this can be
   * committed with commitPreview() or rolled back with cancelPreview().
   */
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

  public getSelectionBounds(): SelectionBounds | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;
    return getSegmentAwareBounds(snapshot, this.selection.getSelectedPoints());
  }

  public getSelectionCenter(): Point2D | null {
    const bounds = this.getSelectionBounds();
    return bounds?.center ?? null;
  }

  public rotateSelection(angle: number, origin?: Point2D): void {
    const pointIds = this.selection.getSelectedPoints();
    if (pointIds.length === 0) return;

    const center = origin ?? this.getSelectionCenter();
    if (!center) return;

    const cmd = new RotatePointsCommand([...pointIds], angle, center);
    this.#commandHistory.execute(cmd);
  }

  public scaleSelection(sx: number, sy: number, origin?: Point2D): void {
    const pointIds = this.selection.getSelectedPoints();
    if (pointIds.length === 0) return;

    const o = origin ?? this.getSelectionCenter();
    if (!o) return;

    const cmd = new ScalePointsCommand([...pointIds], sx, sy, o);
    this.#commandHistory.execute(cmd);
  }

  public reflectSelection(axis: ReflectAxis, origin?: Point2D): void {
    const pointIds = this.selection.getSelectedPoints();
    if (pointIds.length === 0) return;

    const center = origin ?? this.getSelectionCenter();
    if (!center) return;

    const cmd = new ReflectPointsCommand([...pointIds], axis, center);
    this.#commandHistory.execute(cmd);
  }

  public moveSelectionTo(target: Point2D, anchor: Point2D): void {
    const pointIds = this.selection.getSelectedPoints();
    if (pointIds.length === 0) return;

    const cmd = new MoveSelectionToCommand([...pointIds], target, anchor);
    this.#commandHistory.execute(cmd);
  }

  public alignSelection(alignment: AlignmentType): void {
    const pointIds = this.selection.getSelectedPoints();
    if (pointIds.length === 0) return;

    const cmd = new AlignPointsCommand([...pointIds], alignment);
    this.#commandHistory.execute(cmd);
  }

  public distributeSelection(type: DistributeType): void {
    const pointIds = this.selection.getSelectedPoints();
    if (pointIds.length < 3) return;

    const cmd = new DistributePointsCommand([...pointIds], type);
    this.#commandHistory.execute(cmd);
  }

  public getPointById(pointId: PointId): Point | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;

    const result = findPointInSnapshot(snapshot, pointId);
    return (result?.point as Point) ?? null;
  }

  public getContourById(contourId: ContourId): Contour | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;

    const contour = findContourInSnapshot(snapshot, contourId);
    return (contour as Contour) ?? null;
  }

  public getPointAt(pos: Point2D): Point | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;

    const hitRadius = this.#viewport.screenToUpmDistance(SCREEN_HIT_RADIUS);

    for (const contour of snapshot.contours) {
      for (const point of contour.points) {
        if (Vec2.dist(point, pos) < hitRadius) {
          return point as Point;
        }
      }
    }
    return null;
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
    contour: Contour;
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
          contourId: contour.id,
          pointId: firstPoint.id,
          position: "start",
          contour: contour as Contour,
        };
      }

      if (Vec2.dist(lastPoint, pos) < hitRadius) {
        return {
          contourId: contour.id,
          pointId: lastPoint.id,
          position: "end",
          contour: contour as Contour,
        };
      }
    }
    return null;
  }

  public getSelectionBoundingRect(): Rect2D | null {
    const selectedPointIds = this.#selection.selectedPointIds.peek();
    if (selectedPointIds.size <= 1) return null;

    const mode = this.#selection.selectionMode.peek();
    if (mode !== "committed") return null;

    const points = Array.from(selectedPointIds)
      .map((id) => this.getPointById(id))
      .filter((p): p is Point => p !== null);

    if (points.length === 0) return null;

    return Polygon.boundingRect(points);
  }

  public updateHover(pos: Point2D): void {
    const point = this.getPointAt(pos);
    if (point) {
      this.#hover.setHoveredPoint(point.id);
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

  public getAllPoints(): Point[] {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return [];

    const result: Point[] = [];
    for (const contour of snapshot.contours) {
      result.push(...(contour.points as Point[]));
    }
    return result;
  }

  public getSegmentById(segmentId: SegmentId) {
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
