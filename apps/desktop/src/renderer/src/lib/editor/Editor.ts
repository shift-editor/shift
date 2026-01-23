import type { IGraphicContext, IRenderer } from "@/types/graphics";
import type { HandleState, HandleType } from "@/types/handle";
import type { CursorType, ToolRegistryItem, VisualState } from "@/types/editor";
import type { Point2D, Rect2D, PointId, GlyphSnapshot, PointSnapshot } from "@shift/types";
import { asContourId } from "@shift/types";
import { findPointInSnapshot, findPointsInSnapshot } from "../utils/snapshot";
import { Tool, ToolContext, ToolName } from "@/types/tool";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";

import { drawHandle } from "./handles";
import { Viewport } from "./Viewport";
import { FontEngine } from "@/engine";
import {
  CommandHistory,
  AddPointCommand,
  MovePointsCommand,
  RemovePointsCommand,
  CloseContourCommand,
  AddContourCommand,
  PasteCommand,
} from "../commands";
import {
  Transform,
  RotatePointsCommand,
  ScalePointsCommand,
  ReflectPointsCommand,
  type ReflectAxis,
  type TransformablePoint,
  type SelectionBounds,
} from "../transform";
import { effect, type Effect } from "../reactive/signal";
import { signal, type WritableSignal } from "../reactive/signal";
import { ClipboardManager } from "../clipboard";
import { SelectionManager } from "./SelectionManager";
import { HoverManager } from "./HoverManager";
import { GlyphRenderer } from "./GlyphRenderer";

const DEBUG = false;
const SCREEN_HIT_RADIUS = 8;

function cursorToCSS(cursor: CursorType): string {
  switch (cursor.type) {
    case "pen":
      return `-webkit-image-set(url("/cursors/pen@32.svg") 1x, url("/cursors/pen@64.svg") 2x) 8 8, crosshair`;
    case "pen-end":
      return `-webkit-image-set(url("/cursors/pen@32-end.svg") 1x, url("/cursors/pen@64-end.svg") 2x) 8 8, crosshair`;
    default:
      return cursor.type;
  }
}

function debug(...args: unknown[]) {
  if (DEBUG) {
    console.log("[Editor]", ...args);
  }
}


export class Editor {
  #previewMode: WritableSignal<boolean>;

  #selection: SelectionManager;
  #hover: HoverManager;
  #renderer: GlyphRenderer;

  #tools: Map<ToolName, ToolRegistryItem>;
  #activeTool: WritableSignal<ToolName>;

  #viewport: Viewport;
  #commandHistory: CommandHistory;
  #fontEngine: FontEngine;
  #redrawEffect: Effect;
  #clipboardManager: ClipboardManager;

  /** Reactive cursor signal - subscribe to this for cursor changes */
  #cursor: WritableSignal<string>;

  constructor() {
    this.#viewport = new Viewport();
    this.#fontEngine = new FontEngine();
    this.#commandHistory = new CommandHistory(
      this.#fontEngine,
      () => this.#fontEngine.snapshot.value,
    );

    this.#previewMode = signal(false);
    this.#cursor = signal("default");

    this.#selection = new SelectionManager();
    this.#hover = new HoverManager();

    this.#tools = new Map();
    this.#activeTool = signal<ToolName>("select");

    this.#renderer = new GlyphRenderer({
      viewport: this.#viewport,
      getSnapshot: () => this.#fontEngine.snapshot.value,
      getFontMetrics: () => this.#fontEngine.info.getMetrics(),
      getActiveTool: () => this.getActiveTool(),
      selection: this.#selection,
      hover: this.#hover,
      getPreviewMode: () => this.previewMode,
      getHandleState: (pointId) => this.getHandleState(pointId),
      paintHandle: (ctx, x, y, handleType, state, isCounterClockWise) =>
        this.paintHandle(ctx, x, y, handleType, state, isCounterClockWise),
      getSelectedPointData: () => this.#getSelectedPointData(),
    });

    this.#clipboardManager = new ClipboardManager({
      getSnapshot: () => this.#fontEngine.snapshot.value,
      getSelectedPointIds: () => this.#selection.selectedPointIdsSignal.peek(),
      getSelectedSegmentIds: () =>
        this.#selection.selectedSegmentIdsSignal.peek(),
      getGlyphName: () => this.#fontEngine.snapshot.value?.name,
      pasteContours: (json, x, y) =>
        this.#fontEngine.editing.pasteContours(json, x, y),
      selectPoints: (ids) => this.selectPoints(ids),
    });

    this.#redrawEffect = effect(() => {
      this.#fontEngine.snapshot.value;
      this.#selection.selectedPointIdsSignal.value;
      this.#selection.selectedSegmentIdsSignal.value;
      this.#selection.selectionModeSignal.value;
      this.#hover.hoveredPointIdSignal.value;
      this.#hover.hoveredSegmentIdSignal.value;
      this.#previewMode.value;
      this.requestRedraw();
    });
  }

  public registerTool(
    name: ToolName,
    tool: Tool,
    icon: React.FC<React.SVGProps<SVGSVGElement>>,
    tooltip: string,
  ): void {
    this.#tools.set(name, { tool, icon, tooltip });
  }

  public get tools(): ReadonlyMap<ToolName, ToolRegistryItem> {
    return this.#tools;
  }

  public get activeTool(): ToolName {
    return this.#activeTool.value;
  }

  public get activeToolSignal(): WritableSignal<ToolName> {
    return this.#activeTool;
  }

  public setActiveTool(toolName: ToolName): void {
    const currentToolName = this.#activeTool.value;
    if (currentToolName === toolName) return;

    // Deactivate the current tool
    const oldTool = this.#tools.get(currentToolName);
    if (oldTool) {
      oldTool.tool.setIdle();
    }

    // Activate the new tool
    const newTool = this.#tools.get(toolName);
    if (newTool) {
      newTool.tool.setReady();
    }

    this.#activeTool.set(toolName);
  }

  public getActiveTool(): Tool {
    const tool = this.#tools.get(this.#activeTool.value);
    if (!tool) {
      throw new Error(`Tool ${this.#activeTool.value} not found`);
    }
    return tool.tool;
  }

  public get selectedPointIds(): ReadonlySet<PointId> {
    return this.#selection.selectedPointIds;
  }

  public selectPoint(pointId: PointId): void {
    this.#selection.selectPoint(pointId);
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

  public get selectedSegmentIds(): ReadonlySet<SegmentId> {
    return this.#selection.selectedSegmentIds;
  }

  public selectSegment(segmentId: SegmentId): void {
    this.#selection.selectSegment(segmentId);
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

  public get selectionMode() {
    return this.#selection.selectionMode;
  }

  public setSelectionMode(mode: "preview" | "committed"): void {
    this.#selection.setSelectionMode(mode);
  }

  public get hoveredPointId(): PointId | null {
    return this.#hover.hoveredPointId;
  }

  public get hoveredSegmentId(): SegmentIndicator | null {
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

  public get previewMode(): boolean {
    return this.#previewMode.value;
  }

  public setPreviewMode(enabled: boolean): void {
    this.#previewMode.set(enabled);
  }

  public setStaticContext(context: IGraphicContext) {
    this.#renderer.setStaticContext(context);
  }

  public setInteractiveContext(context: IGraphicContext) {
    this.#renderer.setInteractiveContext(context);
  }

  public startEditSession(unicode: number): void {
    debug("Starting edit session for unicode:", unicode);
    this.#fontEngine.session.startEditSession(unicode);
    this.#fontEngine.editing.addContour();
  }

  public endEditSession(): void {
    this.#fontEngine.session.endEditSession();
  }

  public getSnapshot(): GlyphSnapshot | null {
    return this.#fontEngine.snapshot.value;
  }

  public createToolContext(): ToolContext {
    const viewport = this.#viewport;
    const fontEngine = this.#fontEngine;
    const commands = this.#commandHistory;
    const requestRedraw = () => this.requestRedraw();

    return {
      snapshot: fontEngine.snapshot.value,
      selectedPoints: this.selectedPointIds,
      hoveredPoint: this.hoveredPointId,
      hoveredSegment: this.hoveredSegmentId,
      mousePosition: viewport.getUpmMousePosition(),
      selectionMode: this.selectionMode,

      screen: {
        toUpmDistance: (px) => viewport.screenToUpmDistance(px),
        get hitRadius() {
          return viewport.screenToUpmDistance(SCREEN_HIT_RADIUS);
        },
        lineWidth: (px = 1) => viewport.screenToUpmDistance(px),
      },

      select: {
        set: (ids) => this.selectPoints(ids),
        add: (id) => this.addPointToSelection(id),
        remove: (id) => this.removePointFromSelection(id),
        toggle: (id) => this.togglePointSelection(id),
        clear: () => this.clearSelection(),
        has: () => this.hasSelection(),
        setMode: (mode) => this.setSelectionMode(mode),
      },

      indicators: {
        setHoveredPoint: (id) => this.setHoveredPoint(id),
        setHoveredSegment: (indicator) => this.setHoveredSegment(indicator),
        clearAll: () => this.clearHover(),
      },

      edit: {
        addPoint: (x, y, type) => {
          const cmd = new AddPointCommand(x, y, type, false);
          return commands.execute(cmd);
        },
        movePoints: (ids, dx, dy) => {
          const cmd = new MovePointsCommand([...ids], dx, dy);
          commands.execute(cmd);
        },
        movePointTo: (id, x, y) => {
          fontEngine.editing.movePointTo(id, x, y);
        },
        applySmartEdits: (ids, dx, dy) => {
          return fontEngine.editing.applySmartEdits(ids, dx, dy);
        },
        removePoints: (ids) => {
          const cmd = new RemovePointsCommand([...ids]);
          commands.execute(cmd);
        },
        addContour: () => {
          const cmd = new AddContourCommand();
          return commands.execute(cmd);
        },
        closeContour: () => {
          const cmd = new CloseContourCommand();
          commands.execute(cmd);
        },
        toggleSmooth: (id) => {
          fontEngine.editing.toggleSmooth(id);
        },
        getActiveContourId: () => {
          const id = fontEngine.editing.getActiveContourId();
          return id ? asContourId(id) : null;
        },
        setActiveContour: (contourId) => {
          fontEngine.editing.setActiveContour(contourId);
        },
        reverseContour: (contourId) => {
          fontEngine.editing.reverseContour(contourId);
        },
        addPointToContour: (contourId, x, y, type, smooth) => {
          return fontEngine.editing.addPointToContour(
            contourId,
            x,
            y,
            type as any,
            smooth,
          );
        },
      },

      transform: {
        rotate: (angle, origin) => {
          this.rotateSelection(angle, origin);
        },
        scale: (sx, sy, origin) => {
          this.scaleSelection(sx, sy ?? sx, origin);
        },
        reflect: (axis, origin) => {
          this.reflectSelection(axis, origin);
        },
        rotate90CCW: () => {
          this.rotateSelection(Math.PI / 2);
        },
        rotate90CW: () => {
          this.rotateSelection(-Math.PI / 2);
        },
        rotate180: () => {
          this.rotateSelection(Math.PI);
        },
        flipHorizontal: () => {
          this.reflectSelection("horizontal");
        },
        flipVertical: () => {
          this.reflectSelection("vertical");
        },
        getSelectionBounds: () => {
          return this.getSelectionBounds();
        },
        getSelectionCenter: () => {
          return this.getSelectionCenter();
        },
      },

      commands,
      requestRedraw,
    };
  }

  public get commandHistory(): CommandHistory {
    return this.#commandHistory;
  }

  public undo() {
    this.#commandHistory.undo();
    this.redrawGlyph();
  }

  public redo() {
    this.#commandHistory.redo();
    this.redrawGlyph();
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

  public zoom(): number {
    return this.#viewport.zoom;
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
    isCounterClockWise?: boolean,
  ) {
    drawHandle(ctx, handleType, x, y, state, { isCounterClockWise });
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

  /** Get the current cursor value */
  public get cursor(): string {
    return this.#cursor.value;
  }

  /** Get the cursor signal for reactive subscriptions */
  public get cursorSignal(): WritableSignal<string> {
    return this.#cursor;
  }

  /** Set the cursor style using a discriminated union type */
  public setCursor(cursor: CursorType): void {
    this.#cursor.set(cursorToCSS(cursor));
  }

  public deleteSelectedPoints(): void {
    const selectedIds = this.#selection.selectedPointIdsSignal.peek();
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


  /**
   * Get the bounding box and center of the current selection.
   * Returns null if no points are selected.
   */
  public getSelectionBounds(): SelectionBounds | null {
    const points = this.#getTransformablePoints();
    return Transform.getSelectionBounds(points);
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
    const pointIds = [...this.#selection.selectedPointIdsSignal.peek()];
    if (pointIds.length === 0) return;

    const center = origin ?? this.getSelectionCenter();
    if (!center) return;

    const cmd = new RotatePointsCommand(pointIds, angle, center);
    this.#commandHistory.execute(cmd);
  }

  /**
   * Scale selected points.
   * @param sx - Scale factor X
   * @param sy - Scale factor Y
   * @param origin - Optional origin; defaults to selection center
   */
  public scaleSelection(sx: number, sy: number, origin?: Point2D): void {
    const pointIds = [...this.#selection.selectedPointIdsSignal.peek()];
    if (pointIds.length === 0) return;

    const o = origin ?? this.getSelectionCenter();
    if (!o) return;

    const cmd = new ScalePointsCommand(pointIds, sx, sy, o);
    this.#commandHistory.execute(cmd);
  }

  /**
   * Reflect (mirror) selected points across an axis.
   * @param axis - 'horizontal' | 'vertical' | { angle: number }
   * @param origin - Optional origin; defaults to selection center
   */
  public reflectSelection(axis: ReflectAxis, origin?: Point2D): void {
    const pointIds = [...this.#selection.selectedPointIdsSignal.peek()];
    if (pointIds.length === 0) return;

    const center = origin ?? this.getSelectionCenter();
    if (!center) return;

    const cmd = new ReflectPointsCommand(pointIds, axis, center);
    this.#commandHistory.execute(cmd);
  }

  public findPoint(pointId: PointId): PointSnapshot | null {
    const snapshot = this.#fontEngine.snapshot.value;
    if (!snapshot) return null;

    const result = findPointInSnapshot(snapshot, pointId);
    return result?.point ?? null;
  }

  #getSelectedPointData(): Array<{ x: number; y: number }> {
    const snapshot = this.#fontEngine.snapshot.value;
    if (!snapshot) return [];

    const result: Array<{ x: number; y: number }> = [];
    for (const pointId of this.#selection.selectedPointIdsSignal.peek()) {
      const found = findPointInSnapshot(snapshot, pointId);
      if (found) {
        result.push({ x: found.point.x, y: found.point.y });
      }
    }
    return result;
  }

  #getTransformablePoints(): TransformablePoint[] {
    const snapshot = this.#fontEngine.snapshot.value;
    if (!snapshot) return [];

    return findPointsInSnapshot(
      snapshot,
      this.#selection.selectedPointIdsSignal.peek(),
    ).map((p) => ({
      id: p.id as PointId,
      x: p.x,
      y: p.y,
    }));
  }

  public redrawGlyph() {
    this.requestRedraw();
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
