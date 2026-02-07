import type { IGraphicContext } from "@/types/graphics";
import type { HandleState } from "@/types/graphics";
import type {
  CursorType,
  SnapPreferences,
  SelectionMode,
  ToolRegistryItem,
  VisualState,
  RenderState,
  StaticRenderState,
  OverlayRenderState,
  InteractiveRenderState,
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
  PointType,
} from "@shift/types";
import type { ToolName, ActiveToolState } from "../tools/core";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { HitResult, MiddlePointHit, ContourEndpointHit, HoverResult } from "@/types/hitResult";
import { ToolManager } from "../tools/core/ToolManager";
import { SnapshotCommand } from "../commands/primitives/SnapshotCommand";
import { Segment, type SegmentHitResult } from "../geo/Segment";
import { Bounds, Polygon, Vec2 } from "@shift/geo";
import { Contours, Glyphs } from "@shift/font";
import type { BoundingBoxHitResult } from "@/types/boundingBox";

import { ViewportManager } from "./managers";
import { FontEngine } from "@/engine";
import { glyphOutlineStore } from "@/store/GlyphOutlineStore";
import { CommandHistory, CutCommand, PasteCommand } from "../commands";
import {
  RotatePointsCommand,
  ScalePointsCommand,
  ReflectPointsCommand,
  MoveSelectionToCommand,
  AlignPointsCommand,
  DistributePointsCommand,
  getSegmentAwareBounds,
  type ReflectAxis,
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
import { ClipboardService, ContentResolver } from "../clipboard";
import { cursorToCSS } from "../styles/cursor";
import { BOUNDING_BOX_HANDLE_STYLES } from "../styles/style";
import { hitTestBoundingBox } from "../tools/select/boundingBoxHitTest";
import { pointInRect } from "../tools/select/utils";
import { SelectionManager, HoverManager, EdgePanManager } from "./managers";
import {
  CanvasCoordinator,
  type CanvasCoordinatorContext,
  type ViewportTransform,
} from "./rendering/CanvasCoordinator";
import type { FocusZone } from "@/types/focus";
import type { TemporaryToolOptions } from "@/types/editor";
import type { ToolContext } from "../tools/core/ToolContext";
import type { DrawAPI } from "../tools/core/DrawAPI";
import type { Modifiers } from "../tools/core/GestureDetector";
import type {
  DragSnapSession,
  DragSnapSessionConfig,
  RotateSnapSession,
  SnapIndicator,
} from "./snapping/types";
import { EditorSnapManager } from "./managers/EditorSnapManager";
import { ToolDescriptor } from "@/types/tools";

interface EditorFacade extends ToolContext, CanvasCoordinatorContext {}

export class Editor implements EditorFacade {
  private $previewMode: WritableSignal<boolean>;
  private $handlesVisible: WritableSignal<boolean>;

  #selection: SelectionManager;
  #hover: HoverManager;
  #renderer: CanvasCoordinator;
  #edgePan: EdgePanManager;
  #snapManager: EditorSnapManager;

  #toolManager: ToolManager;
  #toolMetadata: Map<
    ToolName,
    { icon: React.FC<React.SVGProps<SVGSVGElement>>; tooltip: string; shortcut?: string }
  >;
  private $activeTool: WritableSignal<ToolName>;
  private $activeToolState: WritableSignal<ActiveToolState>;

  #viewport: ViewportManager;
  #commandHistory: CommandHistory;
  #fontEngine: FontEngine;
  #$glyph: ComputedSignal<Glyph | null>;
  #staticEffect: Effect;
  #overlayEffect: Effect;
  #interactiveEffect: Effect;
  #cursorEffect: Effect;
  #clipboardService: ClipboardService;

  #previewSnapshot: GlyphSnapshot | null = null;
  #isInPreview: boolean = false;
  #zone: FocusZone = "canvas";
  #marqueePreviewPointIds: WritableSignal<Set<PointId> | null>;

  $renderState: ComputedSignal<RenderState>;
  $staticState: ComputedSignal<StaticRenderState>;
  $overlayState: ComputedSignal<OverlayRenderState>;
  $interactiveState: ComputedSignal<InteractiveRenderState>;
  private $cursor: WritableSignal<string>;
  #currentModifiers: WritableSignal<Modifiers>;
  #isHoveringNode: ComputedSignal<boolean>;
  #snapPreferences: WritableSignal<SnapPreferences>;
  #snapIndicator: WritableSignal<SnapIndicator | null>;

  constructor() {
    this.#viewport = new ViewportManager();
    this.#fontEngine = new FontEngine();
    this.#$glyph = computed<Glyph | null>(() => this.#fontEngine.$glyph.value as Glyph | null);
    this.#commandHistory = new CommandHistory(
      this.#fontEngine,
      () => this.#fontEngine.$glyph.value,
    );

    this.$previewMode = signal(false);
    this.$cursor = signal("default");
    this.$handlesVisible = signal(true);
    this.#currentModifiers = signal<Modifiers>({
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
    this.#snapPreferences = signal<SnapPreferences>({
      enabled: true,
      angle: true,
      metrics: true,
      pointToPoint: true,
      angleIncrementDeg: 45,
      pointRadiusPx: 8,
    });
    this.#snapIndicator = signal<SnapIndicator | null>(null);

    this.#selection = new SelectionManager();
    this.#hover = new HoverManager();
    this.#edgePan = new EdgePanManager(this);
    this.#snapManager = new EditorSnapManager({
      getGlyph: () => this.getGlyph(),
      getMetrics: () => this.getFontMetrics(),
      getPreferences: () => this.#snapPreferences.value,
      screenToUpmDistance: (px) => this.screenToUpmDistance(px),
    });
    this.#isHoveringNode = computed(
      () =>
        this.#hover.hoveredPointId.value !== null || this.#hover.hoveredSegmentId.value !== null,
    );

    this.#toolMetadata = new Map();
    this.$activeTool = signal<ToolName>("select");
    this.$activeToolState = signal<ActiveToolState>({ type: "idle" });
    this.#marqueePreviewPointIds = signal<Set<PointId> | null>(null);

    this.#toolManager = new ToolManager(this);
    this.#renderer = new CanvasCoordinator(this);

    this.#clipboardService = new ClipboardService({
      getGlyph: () => this.getGlyph(),
      getSelectedPointIds: () => this.getSelectedPoints(),
      getSelectedSegmentIds: () => this.getSelectedSegments(),
    });

    this.$renderState = computed<RenderState>(() => ({
      glyph: this.#$glyph.value,
      selectedPointIds: this.#selection.selectedPointIds.value,
      selectedSegmentIds: this.#selection.selectedSegmentIds.value,
      hoveredPointId: this.#hover.hoveredPointId.value,
      hoveredSegmentId: this.#hover.hoveredSegmentId.value,
      selectionMode: this.#selection.selectionMode.value,
      previewMode: this.$previewMode.value,
    }));

    this.$staticState = computed<StaticRenderState>(() => ({
      glyph: this.#$glyph.value,
      selectedPointIds: this.#selection.selectedPointIds.value,
      selectedSegmentIds: this.#selection.selectedSegmentIds.value,
      selectionMode: this.#selection.selectionMode.value,
      previewMode: this.$previewMode.value,
      handlesVisible: this.$handlesVisible.value,
      hoveredPointId: this.#hover.hoveredPointId.value,
      hoveredSegmentId: this.#hover.hoveredSegmentId.value,
    }));

    this.$overlayState = computed<OverlayRenderState>(() => ({
      glyph: this.#$glyph.value,
      selectedSegmentIds: this.#selection.selectedSegmentIds.value,
      hoveredPointId: this.#hover.hoveredPointId.value,
      hoveredSegmentId: this.#hover.hoveredSegmentId.value,
      snapIndicator: this.#snapIndicator.value,
    }));

    this.$interactiveState = computed<InteractiveRenderState>(() => ({
      activeToolState: this.$activeToolState.value,
    }));

    this.#staticEffect = effect(() => {
      this.$staticState.value;
      this.#renderer.requestStaticRedraw();
    });

    this.#overlayEffect = effect(() => {
      this.$overlayState.value;
      this.#renderer.requestOverlayRedraw();
    });

    this.#interactiveEffect = effect(() => {
      this.$interactiveState.value;
      this.#renderer.requestInteractiveRedraw();
    });

    this.#cursorEffect = effect(() => {
      // Depend on active tool signals to re-run when tool changes
      this.$activeTool.value;
      this.$activeToolState.value;
      const activeTool = this.#toolManager.activeTool;
      if (activeTool) {
        const cursor = activeTool.getCursor(activeTool.state);
        this.setCursor(cursor);
        return;
      }

      this.setCursor({ type: "default" });
    });
  }

  public registerTool(descriptor: ToolDescriptor): void {
    const { id, ToolClass, icon, tooltip, shortcut } = descriptor;
    this.#toolMetadata.set(id, { icon, tooltip, shortcut });
    this.toolManager.register(id, ToolClass);
  }

  public get toolRegistry(): ReadonlyMap<ToolName, ToolRegistryItem> {
    const result = new Map<ToolName, ToolRegistryItem>();
    for (const [name, metadata] of this.#toolMetadata) {
      result.set(name, {
        icon: metadata.icon,
        tooltip: metadata.tooltip,
        shortcut: metadata.shortcut,
      });
    }
    return result;
  }

  public getToolShortcuts(): Array<{ toolId: ToolName; shortcut: string }> {
    const out: Array<{ toolId: ToolName; shortcut: string }> = [];
    for (const [toolId, metadata] of this.#toolMetadata) {
      if (metadata.shortcut != null) {
        out.push({ toolId, shortcut: metadata.shortcut });
      }
    }
    return out;
  }

  public get activeTool(): Signal<ToolName> {
    return this.$activeTool;
  }

  public getActiveTool(): ToolName {
    return this.$activeTool.value;
  }

  public get activeToolState(): Signal<ActiveToolState> {
    return this.$activeToolState;
  }

  public getActiveToolState(): ActiveToolState {
    return this.$activeToolState.value;
  }

  public setActiveToolState(state: ActiveToolState): void {
    this.$activeToolState.set(state);
  }

  public setActiveTool(toolName: ToolName): void {
    const currentToolName = this.$activeTool.value;
    if (currentToolName === toolName) return;

    this.toolManager.activate(toolName);
    this.$activeTool.set(toolName);
  }

  public get toolManager(): ToolManager {
    return this.#toolManager;
  }

  public renderTool(draw: DrawAPI): void {
    this.#toolManager.render(draw);
  }

  public renderToolBelowHandles(draw: DrawAPI): void {
    this.#toolManager.renderBelowHandles(draw);
  }

  public requestTemporaryTool(toolId: ToolName, options?: TemporaryToolOptions): void {
    this.toolManager.requestTemporary(toolId, options);
  }

  public returnFromTemporaryTool(): void {
    this.toolManager.returnFromTemporary();
  }

  public get selectedPointIds(): Signal<ReadonlySet<PointId>> {
    return this.#selection.selectedPointIds;
  }

  public selectPoints(pointIds: PointId[]): void {
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

  public getSelectedPoints(): PointId[] {
    return [...this.#selection.selectedPointIds.peek()];
  }

  public getSelectedSegments(): SegmentId[] {
    return [...this.#selection.selectedSegmentIds.peek()];
  }

  public getSelectionMode(): SelectionMode {
    return this.#selection.selectionMode.peek();
  }

  public selectAll(): void {
    const points = this.getAllPoints();
    this.#selection.selectPoints(points.map((p) => p.id));
    this.toolManager.notifySelectionChanged();
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

  public get hoveredBoundingBoxHandle(): Signal<BoundingBoxHitResult> {
    return this.#hover.hoveredBoundingBoxHandle;
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

  public hitTestBoundingBoxAt(pos: Point2D): BoundingBoxHitResult {
    const rect = this.getSelectionBoundingRect();
    if (!rect) return null;

    const handleOffset = this.screenToUpmDistance(BOUNDING_BOX_HANDLE_STYLES.handle.offset);
    const rotationZoneOffset = this.screenToUpmDistance(
      BOUNDING_BOX_HANDLE_STYLES.rotationZoneOffset,
    );

    return hitTestBoundingBox(pos, rect, this.hitRadius, handleOffset, rotationZoneOffset);
  }

  public getHoveredBoundingBoxHandle(): BoundingBoxHitResult {
    return this.#hover.getHoveredBoundingBoxHandle();
  }

  public clearHover(): void {
    this.#hover.clearHover();
  }

  public get isHoveringNode(): Signal<boolean> {
    return this.#isHoveringNode;
  }

  public getIsHoveringNode(): boolean {
    return this.#isHoveringNode.value;
  }

  public get currentModifiers(): Signal<Modifiers> {
    return this.#currentModifiers;
  }

  public getCurrentModifiers(): Modifiers {
    return this.#currentModifiers.value;
  }

  public setCurrentModifiers(modifiers: Modifiers): void {
    this.#currentModifiers.set(modifiers);
  }

  public getSnapPreferences(): SnapPreferences {
    return this.#snapPreferences.value;
  }

  public setSnapPreferences(next: Partial<SnapPreferences>): void {
    this.#snapPreferences.set({
      ...this.#snapPreferences.value,
      ...next,
    });
  }

  public createDragSnapSession(config: DragSnapSessionConfig): DragSnapSession {
    return this.#snapManager.createDragSession(config);
  }

  public createRotateSnapSession(): RotateSnapSession {
    return this.#snapManager.createRotateSession();
  }

  public setSnapIndicator(indicator: SnapIndicator | null): void {
    this.#snapIndicator.set(indicator);
  }

  public getSnapIndicator(): SnapIndicator | null {
    return this.#snapIndicator.peek();
  }

  public getHoveredPoint(): PointId | null {
    return this.#hover.hoveredPointId.peek();
  }

  public getHoveredSegment(): SegmentIndicator | null {
    return this.#hover.hoveredSegmentId.peek();
  }

  public getHoveredSegmentId(): SegmentId | null {
    const hoveredSegment = this.getHoveredSegment();
    if (hoveredSegment == null) return null;

    return hoveredSegment.segmentId;
  }

  public getPointVisualState(pointId: PointId): VisualState {
    const isSelected = (id: PointId) =>
      this.#selection.isPointSelected(id) || this.isPointInMarqueePreview(id);
    return this.#hover.getPointVisualState(pointId, isSelected);
  }

  public isPointInMarqueePreview(pointId: PointId): boolean {
    const marqueePreviewPointIds = this.#marqueePreviewPointIds.peek();
    if (marqueePreviewPointIds == null) return false;

    return marqueePreviewPointIds.has(pointId);
  }

  public getSegmentVisualState(segmentId: SegmentId): VisualState {
    return this.#hover.getSegmentVisualState(segmentId, (id) =>
      this.#selection.isSegmentSelected(id),
    );
  }

  public get previewMode(): Signal<boolean> {
    return this.$previewMode;
  }

  public isPreviewMode(): boolean {
    return this.$previewMode.peek();
  }

  public setPreviewMode(enabled: boolean): void {
    this.$previewMode.set(enabled);
  }

  public setMarqueePreviewRect(rect: Rect2D | null): void {
    if (rect === null) {
      this.#marqueePreviewPointIds.set(null);
      return;
    }

    const points = this.getAllPoints();
    const ids = points.filter((p) => pointInRect(p, rect)).map((p) => p.id);
    this.#marqueePreviewPointIds.set(new Set(ids));
    this.requestStaticRedraw();
  }

  public get handlesVisible(): Signal<boolean> {
    return this.$handlesVisible;
  }

  public isHandlesVisible(): boolean {
    return this.$handlesVisible.peek();
  }

  public setHandlesVisible(visible: boolean): void {
    this.$handlesVisible.set(visible);
  }

  public setStaticContext(context: IGraphicContext) {
    this.#renderer.setStaticContext(context);
  }

  public setOverlayContext(context: IGraphicContext) {
    this.#renderer.setOverlayContext(context);
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

  public get glyph(): Signal<Glyph | null> {
    return this.#$glyph;
  }

  public getGlyph(): Glyph | null {
    return this.#$glyph.value;
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

  public get fontEngine(): FontEngine {
    return this.#fontEngine;
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

  public getFocusZone(): FocusZone {
    return this.#zone;
  }

  public setZone(zone: FocusZone): void {
    this.#zone = zone;
  }

  public get isInPreview(): boolean {
    return this.#isInPreview;
  }

  public undo() {
    // If in preview mode, cancel the preview first to restore the pre-drag state.
    // This ensures the undo stack stays consistent with the actual state.
    if (this.#isInPreview) {
      this.cancelPreview();
      return;
    }
    this.#commandHistory.undo();
  }

  public redo() {
    // If in preview mode, cancel the preview first.
    // Redo during drag doesn't make semantic sense, so just cancel.
    if (this.#isInPreview) {
      this.cancelPreview();
      return;
    }
    this.#commandHistory.redo();
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

  public get mousePosition(): Point2D {
    return this.#viewport.mousePosition;
  }

  public get screenMousePosition(): Signal<Point2D> {
    return this.#viewport.screenMousePosition;
  }

  public getMousePosition(): Point2D {
    return this.#viewport.mousePosition;
  }

  public getScreenMousePosition(): Point2D {
    return this.#viewport.screenMousePosition.peek();
  }

  public updateMousePosition(clientX: number, clientY: number): void {
    this.#viewport.updateMousePosition(clientX, clientY);
  }

  public flushMousePosition(): void {
    this.#viewport.flushMousePosition();
  }

  public projectScreenToUpm(x: number, y: number): Point2D {
    return this.#viewport.projectScreenToUpm(x, y);
  }

  public get hitRadius(): number {
    return this.#viewport.hitRadius;
  }

  public screenToUpmDistance(pixels: number): number {
    return this.#viewport.screenToUpmDistance(pixels);
  }

  public getViewportTransform(): ViewportTransform {
    return {
      zoom: this.#viewport.zoomLevel,
      panX: this.#viewport.panX,
      panY: this.#viewport.panY,
      centre: this.#viewport.centre,
      upmScale: this.#viewport.upmScale,
      logicalHeight: this.#viewport.logicalHeight,
      padding: this.#viewport.padding,
      descender: this.#viewport.descender,
    };
  }

  public projectUpmToScreen(x: number, y: number): Point2D {
    return this.#viewport.projectUpmToScreen(x, y);
  }

  public get pan(): Point2D {
    return this.#viewport.pan;
  }

  public setPan(x: number, y: number): void {
    this.#viewport.setPan(x, y);
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
    const unicodes = this.#fontEngine.info.getGlyphUnicodes();
    const metrics = this.#fontEngine.info.getMetrics();
    glyphOutlineStore.onFontLoaded(unicodes, metrics);
    this.#commandHistory.clear();
    this.startEditSession(65);
  }

  public async saveFontAsync(filePath: string): Promise<void> {
    return this.#fontEngine.io.saveFontAsync(filePath);
  }

  public setCursor(cursor: CursorType): void {
    this.$cursor.set(cursorToCSS(cursor));
  }

  public getCursor(): string {
    return this.$cursor.value;
  }

  public get zoom(): Signal<number> {
    return this.#viewport.zoom;
  }

  public getZoom(): number {
    return this.#viewport.zoomLevel;
  }

  public get fps(): Signal<number> {
    return this.#renderer.fpsMonitor.fps;
  }

  public startFpsMonitor(): void {
    this.#renderer.fpsMonitor.start();
  }

  public stopFpsMonitor(): void {
    this.#renderer.fpsMonitor.stop();
  }

  public deleteSelectedPoints(): void {
    const selectedIds = this.getSelectedPoints();
    if (selectedIds.length > 0) {
      this.#fontEngine.editing.removePoints(selectedIds);
      this.clearSelection();
    }
  }

  public async copy(): Promise<boolean> {
    const content = this.#clipboardService.resolveSelection();
    if (!content || content.contours.length === 0) return false;

    const glyph = this.getGlyph();
    return this.#clipboardService.write(content, glyph?.name);
  }

  public async cut(): Promise<boolean> {
    const content = this.#clipboardService.resolveSelection();
    if (!content || content.contours.length === 0) return false;

    const glyph = this.getGlyph();
    const written = await this.#clipboardService.write(content, glyph?.name);
    if (!written) return false;

    const pointIds = this.getSelectedPoints();
    const cmd = new CutCommand(pointIds);
    this.#commandHistory.execute(cmd);

    this.clearSelection();
    return true;
  }

  public async paste(): Promise<void> {
    const state = await this.#clipboardService.read();
    if (!state.content || state.content.contours.length === 0) return;

    const offset = this.#clipboardService.getNextPasteOffset();
    const cmd = new PasteCommand(state.content, { offset });
    this.#commandHistory.execute(cmd);

    if (cmd.createdPointIds.length > 0) {
      this.selectPoints(cmd.createdPointIds);
    }
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

  public getSelectionBounds(): Bounds | null {
    const snapshot = this.#fontEngine.$glyph.value;
    if (!snapshot) return null;
    return getSegmentAwareBounds(snapshot, this.getSelectedPoints());
  }

  public getSelectionCenter(): Point2D | null {
    const bounds = this.getSelectionBounds();
    if (!bounds) return null;
    return Bounds.center(bounds);
  }

  public rotateSelection(angle: number, origin?: Point2D): void {
    const pointIds = this.getSelectedPoints();
    if (pointIds.length === 0) return;

    const center = origin ?? this.getSelectionCenter();
    if (!center) return;

    const cmd = new RotatePointsCommand([...pointIds], angle, center);
    this.#commandHistory.execute(cmd);
  }

  public scaleSelection(sx: number, sy: number, origin?: Point2D): void {
    const pointIds = this.getSelectedPoints();
    if (pointIds.length === 0) return;

    const o = origin ?? this.getSelectionCenter();
    if (!o) return;

    const cmd = new ScalePointsCommand([...pointIds], sx, sy, o);
    this.#commandHistory.execute(cmd);
  }

  public reflectSelection(axis: ReflectAxis, origin?: Point2D): void {
    const pointIds = this.getSelectedPoints();
    if (pointIds.length === 0) return;

    const center = origin ?? this.getSelectionCenter();
    if (!center) return;

    const cmd = new ReflectPointsCommand([...pointIds], axis, center);
    this.#commandHistory.execute(cmd);
  }

  public rotate90CCW(): void {
    this.rotateSelection(Math.PI / 2);
  }

  public rotate90CW(): void {
    this.rotateSelection(-Math.PI / 2);
  }

  public rotate180(): void {
    this.rotateSelection(Math.PI);
  }

  public flipHorizontal(): void {
    this.reflectSelection("horizontal");
  }

  public flipVertical(): void {
    this.reflectSelection("vertical");
  }

  public moveSelectionTo(target: Point2D, anchor: Point2D): void {
    const pointIds = this.getSelectedPoints();
    if (pointIds.length === 0) return;

    const cmd = new MoveSelectionToCommand([...pointIds], target, anchor);
    this.#commandHistory.execute(cmd);
  }

  public alignSelection(alignment: AlignmentType): void {
    const pointIds = this.getSelectedPoints();
    if (pointIds.length === 0) return;

    const cmd = new AlignPointsCommand([...pointIds], alignment);
    this.#commandHistory.execute(cmd);
  }

  public distributeSelection(type: DistributeType): void {
    const pointIds = this.getSelectedPoints();
    if (pointIds.length < 3) return;

    const cmd = new DistributePointsCommand([...pointIds], type);
    this.#commandHistory.execute(cmd);
  }

  public getPointById(pointId: PointId): Point | null {
    const glyph = this.getGlyph();
    if (!glyph) return null;

    return Glyphs.findPoint(glyph, pointId)?.point ?? null;
  }

  public getContourById(contourId: ContourId): Contour | null {
    const glyph = this.getGlyph();
    if (!glyph) return null;

    return Glyphs.findContour(glyph, contourId) ?? null;
  }

  public getActiveContourId(): ContourId | null {
    const id = this.#fontEngine.editing.getActiveContourId();
    if (id == null) return null;
    return id;
  }

  public getActiveContour(): Contour | null {
    const activeContourId = this.getActiveContourId();
    if (!activeContourId) return null;
    return this.getContourById(activeContourId);
  }

  public addPoint(x: number, y: number, type: PointType, smooth = false): PointId {
    return this.#fontEngine.editing.addPoint({
      id: "" as PointId,
      x,
      y,
      pointType: type,
      smooth,
    });
  }

  public addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    type: PointType,
    smooth: boolean,
  ): PointId {
    return this.#fontEngine.editing.addPointToContour(contourId, {
      id: "" as PointId,
      x,
      y,
      pointType: type,
      smooth,
    });
  }

  public movePoints(ids: PointId[], dx: number, dy: number): void {
    this.#fontEngine.editing.movePoints(ids, { x: dx, y: dy });
  }

  public movePointTo(id: PointId, x: number, y: number): void {
    this.#fontEngine.editing.movePointTo(id, x, y);
  }

  public applySmartEdits(ids: readonly PointId[], dx: number, dy: number): PointId[] {
    return this.#fontEngine.editing.applySmartEdits(new Set(ids), dx, dy);
  }

  public setPointPositions(moves: Array<{ id: PointId; x: number; y: number }>): void {
    this.#fontEngine.editing.setPointPositions(moves);
  }

  public removePoints(ids: PointId[]): void {
    this.#fontEngine.editing.removePoints(ids);
  }

  public addContour(): ContourId {
    return this.#fontEngine.editing.addContour();
  }

  public closeContour(): void {
    this.#fontEngine.editing.closeContour();
  }

  public toggleSmooth(id: PointId): void {
    this.#fontEngine.editing.toggleSmooth(id);
  }

  public setActiveContour(contourId: ContourId): void {
    this.#fontEngine.editing.setActiveContour(contourId);
  }

  public clearActiveContour(): void {
    this.#fontEngine.editing.clearActiveContour();
  }

  public reverseContour(contourId: ContourId): void {
    this.#fontEngine.editing.reverseContour(contourId);
  }

  public getPointAt(pos: Point2D): Point | null {
    const glyph = this.getGlyph();
    if (!glyph) return null;

    return Glyphs.getPointAt(glyph, pos, this.hitRadius);
  }

  public getSegmentAt(pos: Point2D): SegmentHitResult | null {
    const glyph = this.getGlyph();
    if (!glyph) return null;

    let bestHit: SegmentHitResult | null = null;
    for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
      const hit = Segment.hitTest(segment, pos, this.hitRadius);
      if (hit && (!bestHit || hit.distance < bestHit.distance)) {
        bestHit = hit;
      }
    }
    return bestHit;
  }

  public getNodeAt(pos: Point2D): HitResult {
    const endpoint = this.getContourEndpointAt(pos);

    if (endpoint) {
      const { contourId, pointId, position, contour } = endpoint;

      return {
        type: "contourEndpoint",
        contourId,
        pointId,
        position,
        contour,
      };
    }

    const middle = this.getMiddlePointAt(pos);
    if (middle) return middle;

    const point = this.getPointAt(pos);
    if (point) {
      return { type: "point", point, pointId: point.id };
    }

    const segmentHit = this.getSegmentAt(pos);
    if (segmentHit) {
      return {
        type: "segment",
        segment: segmentHit.segment,
        segmentId: segmentHit.segmentId,
        t: segmentHit.t,
        closestPoint: segmentHit.point,
      };
    }

    return null;
  }

  public getContourEndpointAt(pos: Point2D): ContourEndpointHit | null {
    const glyph = this.getGlyph();
    if (!glyph) return null;

    for (const contour of glyph.contours) {
      if (contour.closed || contour.points.length === 0) continue;

      const firstPoint = contour.points[0];
      const lastPoint = contour.points[contour.points.length - 1];

      if (Vec2.dist(firstPoint, pos) < this.hitRadius) {
        return {
          type: "contourEndpoint",
          contourId: contour.id,
          pointId: firstPoint.id,
          position: "start",
          contour,
        };
      }

      if (Vec2.dist(lastPoint, pos) < this.hitRadius) {
        return {
          type: "contourEndpoint",
          contourId: contour.id,
          pointId: lastPoint.id,
          position: "end",
          contour,
        };
      }
    }
    return null;
  }

  public getSelectionBoundingRect(): Rect2D | null {
    const selectedPoints = this.getSelectedPoints();
    if (selectedPoints.length <= 1) return null;

    if (this.getSelectionMode() !== "committed") return null;

    const points = selectedPoints
      .map((id) => this.getPointById(id))
      .filter((p): p is Point => p !== null);

    if (points.length === 0) return null;

    return Polygon.boundingRect(points);
  }

  public updateHover(pos: Point2D): void {
    this.#hover.applyHoverResult(this.resolveHover(pos));
  }

  private resolveHover(pos: Point2D): HoverResult {
    if (this.getSelectedPoints().length > 1) {
      const bbHit = this.hitTestBoundingBoxAt(pos);
      if (bbHit) {
        return { type: "boundingBox", handle: bbHit };
      }
    }

    const point = this.getPointAt(pos);
    if (point) {
      return { type: "point", pointId: point.id };
    }

    const segmentHit = this.getSegmentAt(pos);
    if (segmentHit) {
      return {
        type: "segment",
        segmentId: segmentHit.segmentId,
        closestPoint: segmentHit.point,
        t: segmentHit.t,
      };
    }

    return { type: "none" };
  }

  public getAllPoints(): Point[] {
    const glyph = this.getGlyph();
    if (!glyph) return [];

    return Glyphs.getAllPoints(glyph);
  }

  public duplicateSelection(): PointId[] {
    const glyph = this.getGlyph();
    if (!glyph) return [];

    const selectedPointIds = this.getSelectedPoints();
    const selectedSegmentIds = this.getSelectedSegments();

    const resolver = new ContentResolver();
    const content = resolver.resolve(glyph, selectedPointIds, selectedSegmentIds);
    if (!content || content.contours.length === 0) return [];

    const contoursJson = JSON.stringify(content.contours);
    const result = this.#fontEngine.editing.pasteContours(contoursJson, 0, 0);
    return result.success ? result.createdPointIds : [];
  }

  public getSegmentById(segmentId: SegmentId) {
    const glyph = this.getGlyph();
    if (!glyph) return null;

    for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
      if (Segment.id(segment) === segmentId) {
        return segment;
      }
    }
    return null;
  }

  public getMiddlePointAt(pos: Point2D): MiddlePointHit | null {
    const glyph = this.getGlyph();
    if (!glyph) return null;

    const activeContourId = this.getActiveContourId();
    const hitRadius = this.hitRadius;

    for (const contour of glyph.contours) {
      if (contour.id === activeContourId || contour.closed) continue;
      if (!Contours.hasInteriorPoints(contour)) continue;

      for (let i = 1; i < contour.points.length - 1; i++) {
        const point = contour.points[i];
        if (Vec2.dist(pos, point) < hitRadius) {
          return {
            type: "middlePoint",
            contourId: contour.id,
            pointId: point.id,
            pointIndex: i,
          };
        }
      }
    }
    return null;
  }

  public requestRedraw() {
    this.#renderer.requestRedraw();
  }

  public requestStaticRedraw() {
    this.#renderer.requestStaticRedraw();
  }

  public requestImmediateRedraw() {
    this.#renderer.requestImmediateRedraw();
  }

  public cancelRedraw() {
    this.#renderer.cancelRedraw();
  }

  public destroy() {
    this.#staticEffect.dispose();
    this.#overlayEffect.dispose();
    this.#interactiveEffect.dispose();
    this.#cursorEffect.dispose();
    this.#renderer.destroy();
  }
}
