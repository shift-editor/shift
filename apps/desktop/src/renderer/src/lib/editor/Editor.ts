import type { HandleState } from "@/types/graphics";
import { ReglHandleContext } from "@/lib/graphics/backends/ReglHandleContext";
import type { CursorType, SnapPreferences, ToolRegistryItem } from "@/types/editor";
import type { Point2D, Rect2D, PointId, AnchorId, ContourId, Contour, Point } from "@shift/types";
import type { Glyph } from "@/lib/model/Glyph";
import type { ToolName, ActiveToolState } from "../tools/core";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { HitResult, MiddlePointHit, ContourEndpointHit, HoverResult } from "@/types/hitResult";
import { ToolManager } from "../tools/core/ToolManager";
import { SnapshotCommand } from "../commands/primitives/SnapshotCommand";
import { SetNodePositionsCommand } from "../commands/primitives/SetNodePositionsCommand";
import type { NodePositionUpdateList } from "@/types/positionUpdate";
import { Segment, type SegmentHitResult } from "@/lib/model/Segment";
import { Bounds, Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { Coordinates } from "@/types/coordinates";

import { ViewportManager } from "./managers";
import { displayAdvance, isNonSpacingGlyph } from "@/lib/utils/unicode";
import { NativeBridge } from "@/bridge";
import {
  CommandHistory,
  SetLeftSidebearingCommand,
  SetRightSidebearingCommand,
  SetXAdvanceCommand,
  NudgePointsCommand,
  SetActiveContourCommand,
  ReverseContourCommand,
  SplitSegmentCommand,
  UpgradeLineToCubicCommand,
} from "../commands";
import {
  RotatePointsCommand,
  ScalePointsCommand,
  ReflectPointsCommand,
  MoveSelectionToCommand,
  AlignPointsCommand,
  DistributePointsCommand,
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
import { Clipboard, resolveClipboardContent } from "../clipboard";
import { cursorToCSS } from "../styles/cursor";
import { DEFAULT_THEME } from "./rendering/Theme";
import { hitTestBoundingBox, isBoundingBoxVisibleAtZoom } from "./hit/boundingBox";
import { pointInRect } from "../tools/select/utils";
import { HoverManager, EdgePanManager } from "./managers";
import { Viewport, type ViewportTransform } from "./rendering/Viewport";
import type { Canvas } from "./rendering/Canvas";
import { Handles } from "./rendering/Handles";
import {
  Guides,
  BoundingBox,
  ControlLines,
  Segments,
  SnapLines,
  DebugOverlays as DebugOverlaysIndicator,
  Anchors,
} from "./rendering/indicators";
import { SCREEN_HIT_RADIUS } from "./rendering/constants";
import { getVisibleSceneBounds } from "./rendering/visibleSceneBounds";
import type { FocusZone } from "@/types/focus";
import type { DebugOverlays } from "@shared/ipc/types";
import type { TemporaryToolOptions } from "@/types/editor";
import { Selection } from "@/types/selection";
import { Font } from "../model/Font";
import type { Modifiers } from "../tools/core/GestureDetector";
import type {
  DragSnapSession,
  DragSnapSessionConfig,
  RotateSnapSession,
  SnapIndicator,
} from "./snapping/types";
import { SnapManager } from "./managers/SnapManager";
import { TextRunController } from "@/lib/tools/text/TextRunController";
import { SnapPreferencesSchema, TextRunModulePayloadSchema } from "@shift/validation";
import type { TextRunModulePayload } from "@/persistence/types";

interface AppSettings {
  snap: SnapPreferences;
}

const defaultAppSettings: AppSettings = {
  snap: {
    enabled: true,
    angle: true,
    metrics: true,
    pointToPoint: true,
    angleIncrementDeg: 45,
    pointRadiusPx: 8,
  },
};
import type { CompositeGlyph } from "@shift/types";
import type { ToolDescriptor, ToolShortcutEntry } from "@/types/tools";
import type { ToolStateScope } from "@/types/editor";
import { EventEmitter } from "./lifecycle";
import { StateRegistry, type ShiftState, type ShiftStateOptions } from "@/lib/state/ShiftState";

import type { LineSegment } from "@/types/segments";
import type { GlyphDraft } from "@/types/draft";

/**
 * Central orchestrator for the glyph editing surface.
 *
 * Editor owns and wires together every subsystem: viewport (UPM/screen
 * transforms), selection, hover, command history, snapping, clipboard,
 * tool management, and rendering (via Viewport). It is passed
 * directly to tools and behaviors.
 *
 * Subsystems communicate through reactive signals. Effects watch composite
 * render-state signals and schedule redraws on the appropriate canvas layer
 * (static, overlay, interactive) when their dependencies change.
 *
 * Typical lifecycle:
 * 1. Construct the Editor (creates all managers and wires signals).
 * 2. Call `loadFont()` to open a font file and populate the glyph store.
 * 3. Register tools via `registerTool()`.
 * 4. Call `setActiveTool()` to begin interaction.
 * 5. Call `destroy()` on teardown to dispose effects and the renderer.
 *
 * @knipclassignore
 */
export class Editor {
  #previewMode: WritableSignal<boolean>;
  #handlesVisible: WritableSignal<boolean>;
  #gpuHandlesEnabled: WritableSignal<boolean>;

  readonly selection: Selection;
  readonly font: Font;
  #hover: HoverManager;
  #renderer: Viewport;
  #edgePan: EdgePanManager;
  #snapManager: SnapManager;

  #guides = new Guides();
  #boundingBox = new BoundingBox();
  #controlLines = new ControlLines();
  #segments = new Segments();
  #snapLines = new SnapLines();
  #debugOverlaysIndicator = new DebugOverlaysIndicator();
  #anchors = new Anchors();
  #handles = new Handles();

  #toolManager: ToolManager;
  #toolMetadata: Map<
    ToolName,
    { icon: React.FC<React.SVGProps<SVGSVGElement>>; tooltip: string; shortcut?: string }
  >;
  private $activeTool: WritableSignal<ToolName>;
  private $activeToolState: WritableSignal<ActiveToolState>;

  #viewport: ViewportManager;
  #commandHistory: CommandHistory;
  #bridge: NativeBridge;
  #$glyph: ComputedSignal<Glyph | null>;
  #$segmentIndex: ComputedSignal<ReadonlyMap<SegmentId, Segment>>;

  #staticEffect: Effect;
  #overlayEffect: Effect;
  #interactiveEffect: Effect;
  #cursorEffect: Effect;
  #clipboard: Clipboard;
  #events: EventEmitter;
  #stateRegistry: StateRegistry;
  #textRunController: TextRunController;
  #mainGlyphUnicode: number | null = null;
  #$glyphFinderOpen: WritableSignal<boolean>;

  #zone: FocusZone = "canvas";
  #marqueePreviewPointIds: WritableSignal<Set<PointId> | null>;

  #drawOffset: WritableSignal<Point2D>;
  #cursor: WritableSignal<string>;
  #currentModifiers: WritableSignal<Modifiers>;
  #isHoveringNode: ComputedSignal<boolean>;
  #settings: ShiftState<AppSettings>;
  #snapIndicator: WritableSignal<SnapIndicator | null>;
  #debugOverlays: WritableSignal<DebugOverlays>;
  #toolState: {
    app: Map<string, unknown>;
    document: Map<string, unknown>;
  };
  #toolStateVersion: WritableSignal<number>;
  /**
   * Initializes all subsystems, wires signal dependencies, and sets up
   * reactive effects that schedule canvas redraws when state changes.
   *
   */
  constructor(options: { bridge: NativeBridge }) {
    this.#viewport = new ViewportManager();
    this.#bridge = options.bridge;
    this.font = new Font(this.#bridge);
    this.#$glyph = computed<Glyph | null>(() => this.#bridge.$glyph.value as Glyph | null);
    this.#$segmentIndex = computed(() => {
      const glyph = this.#$glyph.value;
      if (!glyph) return new Map();
      const segmentsById = new Map<SegmentId, Segment>();
      for (const { segment } of glyph.segments()) {
        segmentsById.set(segment.id, segment);
      }
      return segmentsById;
    });
    this.#commandHistory = new CommandHistory(this.#$glyph);

    this.#previewMode = signal(false);
    this.#cursor = signal("default");
    this.#handlesVisible = signal(true);
    this.#gpuHandlesEnabled = signal(true);
    this.#stateRegistry = new StateRegistry();
    this.#currentModifiers = signal<Modifiers>({
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });

    this.#settings = this.registerState<AppSettings>({
      id: "settings",
      scope: "app",
      initial: () => defaultAppSettings,
      serialize: (v) => v,
      deserialize: (json) => {
        const parsed = json as Record<string, unknown>;
        return {
          snap: SnapPreferencesSchema.parse(parsed.snap ?? defaultAppSettings.snap),
        };
      },
    });

    this.#snapIndicator = signal<SnapIndicator | null>(null);
    this.#debugOverlays = signal<DebugOverlays>({
      tightBounds: false,
      hitRadii: false,
      segmentBounds: false,
      glyphBbox: false,
    });
    this.#toolState = {
      app: new Map<string, unknown>(),
      document: new Map<string, unknown>(),
    };
    this.#toolStateVersion = signal(0);

    this.#$glyphFinderOpen = signal(false);

    this.selection = new Selection(this.#$glyph);
    this.#hover = new HoverManager();
    this.#edgePan = new EdgePanManager(this);
    this.#snapManager = new SnapManager(
      this.#$glyph,
      () => this.font.getMetrics(),
      () => this.settings.snap,
      (px) => this.#viewport.screenToUpmDistance(px),
    );
    this.#isHoveringNode = computed(
      () =>
        this.#hover.hoveredPointId.value !== null ||
        this.#hover.hoveredAnchorId.value !== null ||
        this.#hover.hoveredSegmentId.value !== null,
    );

    this.#toolMetadata = new Map();
    this.$activeTool = signal<ToolName>("select");
    this.$activeToolState = signal<ActiveToolState>({ type: "idle" });
    this.#marqueePreviewPointIds = signal<Set<PointId> | null>(null);

    this.#events = new EventEmitter();
    this.#toolManager = new ToolManager(this);
    this.#renderer = new Viewport(this);
    this.#clipboard = new Clipboard({
      glyph: this.#$glyph,
      selection: this.selection,
      commands: this.#commandHistory,
    });
    this.#textRunController = new TextRunController();
    this.#textRunController.setFont(this.font);

    const textRunPersistence = this.registerState<TextRunModulePayload>({
      id: "text-run",
      scope: "document",
      initial: () => ({ runsByGlyph: {} }),
      serialize: () => ({ runsByGlyph: this.#textRunController.exportRuns() }),
      deserialize: (json) => {
        const payload = TextRunModulePayloadSchema.parse(json);
        this.#textRunController.hydrateRuns(payload.runsByGlyph);
        return payload;
      },
    });

    // Bridge: when text run controller state changes, notify the persistence field
    effect(() => {
      this.#textRunController.state.value;
      textRunPersistence.set({ runsByGlyph: this.#textRunController.exportRuns() });
    });

    this.#events.on("fontLoaded", () => {
      this.#commandHistory.clear();
      this.#textRunController.clearAll();
    });

    this.#drawOffset = signal<Point2D>({ x: 0, y: 0 });

    this.#staticEffect = effect(() => {
      const glyph = this.#$glyph.value;
      if (glyph) {
        glyph.contours;
        glyph.anchors;
      }
      this.#drawOffset.value;
      this.$activeToolState.value;
      this.selection.pointIds;
      this.selection.anchorIds;
      this.selection.segmentIds;
      this.selection.mode;
      this.#previewMode.value;
      this.#handlesVisible.value;
      this.#hover.hoveredPointId.value;
      this.#hover.hoveredAnchorId.value;
      this.#hover.hoveredSegmentId.value;
      this.#hover.hoveredBoundingBoxHandle.value;
      this.#debugOverlays.value;
      this.#gpuHandlesEnabled.value;
      this.#textRunController.state.value;
      this.#renderer.requestSceneRedraw();
      this.#renderer.requestBackgroundRedraw();
    });

    this.#overlayEffect = effect(() => {
      const glyph = this.#$glyph.value;
      if (glyph) {
        glyph.contours;
        glyph.anchors;
      }
      this.#drawOffset.value;
      this.selection.segmentIds;
      this.#hover.hoveredPointId.value;
      this.#hover.hoveredAnchorId.value;
      this.#hover.hoveredSegmentId.value;
      this.#hover.hoveredBoundingBoxHandle.value;
      this.#previewMode.value;
      this.#handlesVisible.value;
      this.#snapIndicator.value;
      this.$activeToolState.value;
      this.#renderer.requestOverlayRedraw();
    });

    this.#interactiveEffect = effect(() => {
      this.$activeToolState.value;
      this.#renderer.requestOverlayRedraw();
    });

    this.#cursorEffect = effect(() => {
      // Depend on active tool signals to re-run when tool changes
      this.$activeTool.value;
      this.$activeToolState.value;
      this.#hover.hoveredBoundingBoxHandle.value;
      this.#hover.hoveredPointId.value;
      this.#hover.hoveredAnchorId.value;
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
    const { id, icon, tooltip, shortcut } = descriptor;
    this.#toolMetadata.set(id, shortcut ? { icon, tooltip, shortcut } : { icon, tooltip });
    this.toolManager.register(descriptor);
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

  public getToolShortcuts(): ToolShortcutEntry[] {
    const out: ToolShortcutEntry[] = [];
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

  // oxlint-disable-next-line shift/no-get-signal-value-method -- retained for upcoming tool refactor
  public getActiveTool(): ToolName {
    return this.$activeTool.value;
  }

  /**
   * Typed as `ActiveToolState` (which is `any`) because each tool defines its
   * own state shape. Consumers should narrow the type based on `activeTool`.
   */
  public get activeToolState(): Signal<ActiveToolState> {
    return this.$activeToolState;
  }

  // oxlint-disable-next-line shift/no-get-signal-value-method -- retained for upcoming tool refactor
  public getActiveToolState(): ActiveToolState {
    return this.$activeToolState.value;
  }

  public setActiveToolState(state: ActiveToolState): void {
    this.$activeToolState.set(state);
  }

  static readonly #DRAG_STATES: ReadonlySet<string> = new Set([
    "translating",
    "resizing",
    "rotating",
    "bending",
  ]);

  #isDragging(): boolean {
    return Editor.#DRAG_STATES.has(this.$activeToolState.peek().type);
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

  public renderToolBackground(canvas: Canvas): void {
    const glyph = this.glyph.peek();
    const previewMode = this.previewMode;

    if (glyph && this.shouldRenderGlyph() && !previewMode) {
      const unicode = Number.isFinite(glyph.unicode) ? glyph.unicode : null;
      const advance = displayAdvance(glyph.xAdvance, glyph.name, unicode);
      this.#guides.draw(canvas, this.font.getMetrics(), advance);
    }

    this.#toolManager.renderBackground(canvas);

    if (!previewMode && !this.#isDragging() && this.shouldRenderGlyph()) {
      const rect = this.getSelectionBoundingRect();
      if (rect) this.#boundingBox.drawRect(canvas, rect);
    }
  }

  public renderToolScene(canvas: Canvas): void {
    const glyph = this.glyph.peek();
    const previewMode = this.previewMode;
    const handlesVisible = this.handlesVisible;

    if (glyph && this.shouldRenderGlyph()) {
      glyph.drawOutline(canvas);
      if (previewMode) glyph.draw(canvas);
    }

    if (!previewMode && glyph && this.shouldRenderGlyph()) {
      const hoveredSegmentId = this.hoveredSegmentId;
      const hoveredSegment = hoveredSegmentId ? this.getSegmentById(hoveredSegmentId) : null;
      const selectedSegments: Segment[] = [];
      for (const segId of this.selection.segmentIds) {
        const seg = this.getSegmentById(segId);
        if (seg) selectedSegments.push(seg);
      }
      this.#segments.draw(canvas, hoveredSegment ?? null, selectedSegments);

      const debugOverlays = this.debugOverlays;
      this.#debugOverlaysIndicator.draw(
        canvas,
        glyph,
        debugOverlays,
        hoveredSegmentId,
        this.screenToUpmDistance(SCREEN_HIT_RADIUS),
      );
    }

    this.#toolManager.renderScene(canvas);

    if (!previewMode && handlesVisible && glyph && this.shouldRenderGlyph()) {
      const viewport = this.getViewportTransform();
      const drawOffset = this.drawOffset;
      const sceneBounds = getVisibleSceneBounds(viewport, 64);

      this.#controlLines.draw(canvas, glyph, (from, to) => {
        const minX = Math.min(from.x, to.x) + drawOffset.x;
        const maxX = Math.max(from.x, to.x) + drawOffset.x;
        const minY = Math.min(from.y, to.y) + drawOffset.y;
        const maxY = Math.max(from.y, to.y) + drawOffset.y;
        return !(
          maxX < sceneBounds.minX ||
          minX > sceneBounds.maxX ||
          maxY < sceneBounds.minY ||
          minY > sceneBounds.maxY
        );
      });

      const renderedOnGpu = this.#handles.draw(
        glyph,
        { getHandleState: (id) => this.getHandleState(id) },
        viewport,
        drawOffset,
        this.gpuHandlesEnabled,
      );
      if (!renderedOnGpu) {
        this.#handles.drawCpu(canvas, glyph, {
          getHandleState: (id) => this.getHandleState(id),
        });
      }

      this.#anchors.draw(canvas, glyph, (id) => this.getAnchorHandleState(id));
    } else {
      this.#handles.clear();
    }
  }

  public renderOverlay(canvas: Canvas): void {
    // Screen-space pass: bounding box handles (skip during drag — handles aren't interactive)
    if (
      !this.previewMode &&
      !this.#isDragging() &&
      this.handlesVisible &&
      this.shouldRenderGlyph()
    ) {
      const rect = this.getSelectionBoundingRect();
      if (rect) {
        const offset = this.drawOffset;
        const topLeft = this.projectSceneToScreen({
          x: rect.x + offset.x,
          y: rect.y + rect.height + offset.y,
        });
        const bottomRight = this.projectSceneToScreen({
          x: rect.x + rect.width + offset.x,
          y: rect.y + offset.y,
        });
        const screenRect: Rect2D = {
          x: topLeft.x,
          y: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
          left: topLeft.x,
          top: topLeft.y,
          right: bottomRight.x,
          bottom: bottomRight.y,
        };
        canvas.ctx.save();
        this.#boundingBox.drawHandles(canvas, screenRect);
        canvas.ctx.restore();
      }
    }

    // UPM-space pass: snap lines + tool overlay
    this.#renderer.beginUpmSpace(canvas);
    const indicator = this.snapIndicator;
    if (indicator) {
      this.#snapLines.draw(canvas, indicator);
    }
    this.#toolManager.renderOverlay(canvas);
    canvas.ctx.restore();
  }

  public requestTemporaryTool(toolId: ToolName, options?: TemporaryToolOptions): void {
    this.toolManager.requestTemporary(toolId, options);
  }

  public returnFromTemporaryTool(): void {
    this.toolManager.returnFromTemporary();
  }

  public selectAll(): void {
    const points = this.getAllPoints();
    this.selection.select(points.map((p) => ({ kind: "point" as const, id: p.id })));
    this.toolManager.notifySelectionChanged();
  }

  public setHoveredPoint(pointId: PointId | null): void {
    this.#hover.setHoveredPoint(pointId);
  }

  public setHoveredAnchor(anchorId: AnchorId | null): void {
    this.#hover.setHoveredAnchor(anchorId);
  }

  public setHoveredSegment(indicator: SegmentIndicator | null): void {
    this.#hover.setHoveredSegment(indicator);
  }

  public hitTestBoundingBoxAt(coords: Coordinates): BoundingBoxHitResult {
    if (!isBoundingBoxVisibleAtZoom(this.zoom)) return null;

    const rect = this.getSelectionBoundingRect();
    if (!rect) return null;

    const handleOffset = this.screenToUpmDistance(DEFAULT_THEME.boundingBox.handle.offset);
    const rotationZoneOffset = this.screenToUpmDistance(
      DEFAULT_THEME.boundingBox.rotationZoneOffset,
    );

    return hitTestBoundingBox(
      coords.glyphLocal,
      rect,
      this.hitRadius,
      handleOffset,
      rotationZoneOffset,
    );
  }

  public get hoveredBoundingBoxHandle(): BoundingBoxHitResult {
    return this.#hover.getHoveredBoundingBoxHandle();
  }

  public clearHover(): void {
    this.#hover.clearHover();
  }

  public get isHoveringNode(): boolean {
    return this.#isHoveringNode.value;
  }

  public get $isHoveringNode(): Signal<boolean> {
    return this.#isHoveringNode;
  }

  public get currentModifiers(): Modifiers {
    return this.#currentModifiers.value;
  }

  public get $currentModifiers(): Signal<Modifiers> {
    return this.#currentModifiers;
  }

  public setCurrentModifiers(modifiers: Modifiers): void {
    this.#currentModifiers.set(modifiers);
  }

  get settings(): AppSettings {
    return this.#settings.value;
  }

  public createDragSnapSession(config: DragSnapSessionConfig): DragSnapSession {
    return this.#snapManager.createDragSession(config);
  }

  public createRotateSnapSession(): RotateSnapSession {
    return this.#snapManager.createRotateSession();
  }

  /**
   * Sets or clears the snap indicator rendered on the overlay canvas.
   *
   * Tools call this with a result from `DragSnapSession.snap()` during a drag,
   * and with `null` when the drag ends or the tool deactivates. Forgetting to
   * clear leaves a stale indicator on screen.
   */
  public setSnapIndicator(indicator: SnapIndicator | null): void {
    this.#snapIndicator.set(indicator);
  }

  public get snapIndicator(): SnapIndicator | null {
    return this.#snapIndicator.value;
  }

  /** @knipclassignore */
  public get $snapIndicator(): Signal<SnapIndicator | null> {
    return this.#snapIndicator;
  }

  public createDraft(): GlyphDraft {
    const glyph = this.#bridge.$glyph.peek();
    if (!glyph) {
      throw new Error("Cannot create draft without an active glyph");
    }

    const base = glyph.toSnapshot();
    let updates: NodePositionUpdateList = [];
    let finished = false;

    return {
      base,
      setPositions: (u) => {
        if (finished) return;
        updates = u;
        glyph.apply(u);
      },
      finish: (label) => {
        if (finished) return;
        finished = true;
        if (updates.length === 0) return;

        this.#bridge.sync(updates);
        this.#commandHistory.record(
          SetNodePositionsCommand.fromBaseGlyphAndUpdates(label, base, updates)!,
        );
      },
      discard: () => {
        if (finished) return;
        finished = true;
        if (updates.length > 0) glyph.apply(base);
      },
    };
  }

  public withBatch<TResult>(label: string, fn: () => TResult): TResult {
    return this.#commandHistory.withBatch(label, fn);
  }

  public get toolStateVersion(): Signal<number> {
    return this.#toolStateVersion;
  }

  public get debugOverlays(): DebugOverlays {
    return this.#debugOverlays.value;
  }

  /** @knipclassignore */
  public get $debugOverlays(): Signal<DebugOverlays> {
    return this.#debugOverlays;
  }

  public setDebugOverlays(overlays: DebugOverlays): void {
    this.#debugOverlays.set(overlays);
  }

  public get hoveredSegmentId(): SegmentId | null {
    const hoveredSegment = this.#hover.hoveredSegmentId.value;
    return hoveredSegment?.segmentId ?? null;
  }

  public isPointInMarqueePreview(pointId: PointId): boolean {
    const marqueePreviewPointIds = this.#marqueePreviewPointIds.peek();
    if (marqueePreviewPointIds == null) return false;

    return marqueePreviewPointIds.has(pointId);
  }

  public get previewMode(): boolean {
    return this.#previewMode.value;
  }

  public get $previewMode(): Signal<boolean> {
    return this.#previewMode;
  }

  public setPreviewMode(enabled: boolean): void {
    this.#previewMode.set(enabled);
  }

  public setMarqueePreviewRect(rect: Rect2D | null): void {
    if (rect === null) {
      this.#marqueePreviewPointIds.set(null);
      return;
    }

    const points = this.getAllPoints();
    const ids = points.filter((p) => pointInRect(p, rect)).map((p) => p.id);
    this.#marqueePreviewPointIds.set(new Set(ids));
    this.requestSceneRedraw();
  }

  public get handlesVisible(): boolean {
    return this.#handlesVisible.value;
  }

  public get $handlesVisible(): Signal<boolean> {
    return this.#handlesVisible;
  }

  public setHandlesVisible(visible: boolean): void {
    this.#handlesVisible.set(visible);
  }

  public get gpuHandlesEnabled(): boolean {
    return this.#gpuHandlesEnabled.value;
  }

  public get $gpuHandlesEnabled(): Signal<boolean> {
    return this.#gpuHandlesEnabled;
  }

  public setGpuHandlesEnabled(enabled: boolean): void {
    this.#gpuHandlesEnabled.set(enabled);
  }

  public setBackgroundContext(ctx: CanvasRenderingContext2D) {
    this.#renderer.setBackgroundContext(ctx);
  }

  public setSceneContext(ctx: CanvasRenderingContext2D) {
    this.#renderer.setSceneContext(ctx);
  }

  public setOverlayContext(ctx: CanvasRenderingContext2D) {
    this.#renderer.setOverlayContext(ctx);
  }

  public setGpuHandleContext(context: ReglHandleContext) {
    this.#renderer.setGpuHandleContext(context);
    this.#handles.setGpu(context);
  }

  public get gpuHandleContext(): ReglHandleContext | null {
    return this.#renderer.gpuHandleContext;
  }

  /** Opens a glyph for editing by name. */
  public open(glyphName: string): void {
    const currentGlyphName = this.#bridge.getEditingGlyphName();
    if (currentGlyphName === glyphName) return;

    this.#bridge.startEditSession(glyphName);
  }

  /** Ends the current editing session. */
  public close(): void {
    this.#bridge.endEditSession();
  }

  public get textRunController(): TextRunController {
    return this.#textRunController;
  }

  /** Resolve a unicode codepoint to a glyph ref and insert into the text run. */
  public insertTextCodepoint(codepoint: number): void {
    const glyphName = this.font.nameForUnicode(codepoint);
    if (!glyphName) return;
    this.#textRunController.insert({ glyphName, unicode: codepoint });
  }

  /** @knipclassignore Indirectly consumed through Viewport. */
  public shouldRenderGlyph(): boolean {
    const state = this.#textRunController.state.peek();
    return !state || state.editingIndex !== null;
  }

  public getGlyphCompositeComponents(glyphName: string): CompositeGlyph | null {
    return this.font.composites(glyphName);
  }

  public getToolState(scope: ToolStateScope, toolId: string, key: string): unknown {
    return this.#getToolScopeMap(scope).get(this.#toolStateKey(toolId, key));
  }

  public setToolState(scope: ToolStateScope, toolId: string, key: string, value: unknown): void {
    const scopedState = this.#getToolScopeMap(scope);
    const stateKey = this.#toolStateKey(toolId, key);
    if (scopedState.get(stateKey) === value) return;
    scopedState.set(stateKey, value);
    this.#bumpToolStateVersion();
  }

  public deleteToolState(scope: ToolStateScope, toolId: string, key: string): void {
    const scopedState = this.#getToolScopeMap(scope);
    const stateKey = this.#toolStateKey(toolId, key);
    if (!scopedState.delete(stateKey)) return;
    this.#bumpToolStateVersion();
  }

  public exportToolState(scope: ToolStateScope): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of this.#getToolScopeMap(scope).entries()) {
      out[key] = value;
    }
    return out;
  }

  public hydrateToolState(scope: ToolStateScope, state: Record<string, unknown>): void {
    const scopedState = this.#getToolScopeMap(scope);
    scopedState.clear();
    for (const [key, value] of Object.entries(state)) {
      scopedState.set(key, value);
    }
    this.#bumpToolStateVersion();
  }

  public clearToolState(scope: ToolStateScope): void {
    const scopedState = this.#getToolScopeMap(scope);
    if (scopedState.size === 0) return;
    scopedState.clear();
    this.#bumpToolStateVersion();
  }

  public get glyph(): Signal<Glyph | null> {
    return this.#$glyph;
  }

  public getActiveGlyphUnicode(): number | null {
    return this.#bridge.getEditingUnicode();
  }

  public getActiveGlyphName(): string | null {
    return this.#bridge.getEditingGlyphName();
  }

  public setMainGlyphUnicode(unicode: number | null): void {
    this.#mainGlyphUnicode = unicode;
    const ref = unicode === null ? null : { glyphName: this.font.glyphName(unicode), unicode };
    this.#textRunController.setOwnerGlyph(ref);
  }

  public getMainGlyphUnicode(): number | null {
    return this.#mainGlyphUnicode;
  }

  public get commandHistory(): CommandHistory {
    return this.#commandHistory;
  }

  /** Subscribe to a lifecycle event. Returns an unsubscribe function. */
  public on: EventEmitter["on"] = (...args) => this.#events.on(...args);

  /** Register persistent state. Returns a reactive handle for reading/writing. */
  public registerState<T>(options: ShiftStateOptions<T>): ShiftState<T> {
    return this.#stateRegistry.register(options);
  }

  /** @internal Used by persistence kernel. */
  get stateRegistry(): StateRegistry {
    return this.#stateRegistry;
  }

  public get commands(): CommandHistory {
    return this.#commandHistory;
  }

  public get bridge(): NativeBridge {
    return this.#bridge;
  }

  public updateEdgePan(screenPos: Point2D, canvasBounds: Rect2D): void {
    this.#edgePan.update(screenPos, canvasBounds);
  }

  public stopEdgePan(): void {
    this.#edgePan.stop();
  }

  public getFocusZone(): FocusZone {
    return this.#zone;
  }

  public setZone(zone: FocusZone): void {
    this.#zone = zone;
  }

  public get glyphFinderOpen(): Signal<boolean> {
    return this.#$glyphFinderOpen;
  }

  public openGlyphFinder(): void {
    this.#$glyphFinderOpen.set(true);
  }

  public closeGlyphFinder(): void {
    this.#$glyphFinderOpen.set(false);
  }

  public undo() {
    this.#commandHistory.undo();
  }

  public redo() {
    this.#commandHistory.redo();
  }

  public setViewportRect(rect: Rect2D) {
    this.#viewport.setRect(rect);
  }

  public setViewportUpm(upm: number) {
    this.#viewport.upm = upm;
  }

  public get xAdvance(): number {
    return this.glyph.value?.xAdvance ?? 0;
  }

  public setXAdvance(width: number): void {
    const glyph = this.#$glyph.value;
    if (!glyph) return;
    if (glyph.xAdvance === width) return;

    this.#commandHistory.execute(new SetXAdvanceCommand(glyph.xAdvance, width));
  }

  public setLeftSidebearing(value: number): void {
    const glyph = this.#$glyph.value;
    if (!glyph) return;

    const { lsb } = glyph.sidebearings;
    if (lsb === null) return;

    const delta = Math.round(value) - Math.round(lsb);
    if (delta === 0) return;

    const beforeXAdvance = glyph.xAdvance;
    this.#commandHistory.execute(
      new SetLeftSidebearingCommand(beforeXAdvance, beforeXAdvance + delta, delta),
    );
  }

  public setRightSidebearing(value: number): void {
    const glyph = this.#$glyph.value;
    if (!glyph) return;

    const { rsb } = glyph.sidebearings;
    if (rsb === null) return;

    const delta = Math.round(value) - Math.round(rsb);
    if (delta === 0) return;

    const beforeXAdvance = glyph.xAdvance;
    this.#commandHistory.execute(
      new SetRightSidebearingCommand(beforeXAdvance, beforeXAdvance + delta),
    );
  }

  public updateMetricsFromFont(): void {
    const metrics = this.font.getMetrics();
    this.#viewport.upm = metrics.unitsPerEm;
    this.#viewport.descender = metrics.descender;
    this.requestRedraw();
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

  public projectScreenToScene(screen: Point2D): Point2D {
    return this.#viewport.projectScreenToScene(screen.x, screen.y);
  }

  public sceneToGlyphLocal(point: Point2D): Point2D {
    const offset = this.#drawOffset.value;
    return { x: point.x - offset.x, y: point.y - offset.y };
  }

  public glyphLocalToScene(point: Point2D): Point2D {
    const offset = this.#drawOffset.value;
    return { x: point.x + offset.x, y: point.y + offset.y };
  }

  public get hitRadius(): number {
    return this.#viewport.hitRadius;
  }

  /** @knipclassignore Indirectly consumed through Viewport. */
  public screenToUpmDistance(pixels: number): number {
    return this.#viewport.screenToUpmDistance(pixels);
  }

  /** @knipclassignore Indirectly consumed through Viewport. */
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

  /** @knipclassignore Indirectly consumed through Viewport. */
  public projectSceneToScreen(scene: Point2D): Point2D {
    return this.#viewport.projectSceneToScreen(scene.x, scene.y);
  }

  public fromScreen(screen: Point2D): Coordinates {
    const scene = this.projectScreenToScene(screen);
    const glyphLocal = this.sceneToGlyphLocal(scene);
    return { screen, scene, glyphLocal };
  }

  public fromScene(scene: Point2D): Coordinates {
    const screen = this.projectSceneToScreen(scene);
    const glyphLocal = this.sceneToGlyphLocal(scene);
    return { screen, scene, glyphLocal };
  }

  public fromGlyphLocal(glyphLocal: Point2D): Coordinates {
    const scene = this.glyphLocalToScene(glyphLocal);
    const screen = this.projectSceneToScreen(scene);
    return { screen, scene, glyphLocal };
  }

  public get pan(): Point2D {
    return this.#viewport.pan;
  }

  public setPan(pan: Point2D): void {
    this.#viewport.setPan(pan.x, pan.y);
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

  /** @knipclassignore Indirectly consumed through Viewport. */
  public getHandleState(pointId: PointId): HandleState {
    const isSelected = (id: PointId) =>
      this.selection.isSelected({ kind: "point", id }) || this.isPointInMarqueePreview(id);
    return this.#hover.getPointVisualState(pointId, isSelected);
  }

  /** @knipclassignore Indirectly consumed through Viewport. */
  public getAnchorHandleState(anchorId: AnchorId): HandleState {
    if (this.selection.isSelected({ kind: "anchor", id: anchorId })) {
      return "selected";
    }
    if (this.#hover.hoveredAnchorId.value === anchorId) {
      return "hovered";
    }
    return "idle";
  }

  /**
   * Loads a font from disk, populates the glyph data store, clears command
   * history, and opens an edit session on Unicode 65 ('A').
   *
   * Ends any active session first. After loading, the viewport UPM and
   * descender are NOT updated here -- call `updateMetricsFromFont()` to sync.
   */
  public loadFont(filePath: string): void {
    if (this.#bridge.hasSession()) {
      this.close();
    }
    this.font.load(filePath);
    this.#events.emit("fontLoaded", { font: this.font });
    this.setMainGlyphUnicode(65);
    const name = this.font.glyphName(65);
    this.open(name);
    this.setDrawOffsetForGlyph({ x: 0, y: 0 }, name, 65);
  }

  public async saveFont(filePath: string): Promise<void> {
    return this.font.save(filePath);
  }

  public setCursor(cursor: CursorType): void {
    this.#cursor.set(cursorToCSS(cursor));
  }

  public get cursor(): string {
    return this.#cursor.value;
  }

  public get $cursor(): Signal<string> {
    return this.#cursor;
  }

  public get zoom(): number {
    return this.#viewport.zoomLevel;
  }

  public get $zoom(): Signal<number> {
    return this.#viewport.zoom;
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
    const glyph = this.#$glyph.value;
    if (!glyph) return;

    const selectedIds = [...this.selection.pointIds];
    if (selectedIds.length > 0) {
      glyph.removePoints(selectedIds);
      this.selection.clear();
    }
  }

  public async copy(): Promise<boolean> {
    return this.#clipboard.copy();
  }

  public async cut(): Promise<boolean> {
    return this.#clipboard.cut();
  }

  public async paste(): Promise<void> {
    return this.#clipboard.paste();
  }

  #selectionCenter(): Point2D | null {
    const bounds = this.selection.bounds;
    return bounds ? Bounds.center(bounds) : null;
  }

  /** @param angle - Rotation in radians. */
  public rotateSelection(angle: number, origin?: Point2D): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const center = origin ?? this.#selectionCenter();
    if (!center) return;

    const cmd = new RotatePointsCommand([...pointIds], angle, center);
    this.#commandHistory.execute(cmd);
  }

  public scaleSelection(sx: number, sy: number, origin?: Point2D): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const o = origin ?? this.#selectionCenter();
    if (!o) return;

    const cmd = new ScalePointsCommand([...pointIds], sx, sy, o);
    this.#commandHistory.execute(cmd);
  }

  public reflectSelection(axis: ReflectAxis, origin?: Point2D): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const center = origin ?? this.#selectionCenter();
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
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const cmd = new MoveSelectionToCommand([...pointIds], target, anchor);
    this.#commandHistory.execute(cmd);
  }

  public alignSelection(alignment: AlignmentType): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const cmd = new AlignPointsCommand([...pointIds], alignment);
    this.#commandHistory.execute(cmd);
  }

  public distributeSelection(type: DistributeType): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length < 3) return;

    const cmd = new DistributePointsCommand([...pointIds], type);
    this.#commandHistory.execute(cmd);
  }

  public getActiveContourId(): ContourId | null {
    const id = this.#bridge.getActiveContourId();
    if (id == null) return null;
    return id;
  }

  public getActiveContour(): Contour | null {
    const activeContourId = this.getActiveContourId();
    if (!activeContourId) return null;

    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    return glyph.contour(activeContourId) ?? null;
  }

  public continueContour(contourId: ContourId, fromStart: boolean, pointId: PointId): void {
    this.#commandHistory.withBatch("Continue Contour", () => {
      this.#commandHistory.execute(new SetActiveContourCommand(contourId));
      if (fromStart) {
        this.#commandHistory.execute(new ReverseContourCommand(contourId));
      }
      this.selection.select([{ kind: "point", id: pointId }]);
    });
  }

  public splitSegment(segment: Segment, t: number): PointId {
    return this.#commandHistory.execute(new SplitSegmentCommand(segment, t));
  }

  public scalePoints(pointIds: readonly PointId[], sx: number, sy: number, anchor: Point2D): void {
    if (pointIds.length === 0 || (sx === 1 && sy === 1)) return;
    this.#commandHistory.execute(new ScalePointsCommand([...pointIds], sx, sy, anchor));
  }

  public rotatePoints(pointIds: readonly PointId[], angle: number, center: Point2D): void {
    if (pointIds.length === 0 || angle === 0) return;
    this.#commandHistory.execute(new RotatePointsCommand([...pointIds], angle, center));
  }

  public nudgePoints(pointIds: readonly PointId[], dx: number, dy: number): void {
    if (pointIds.length === 0 || (dx === 0 && dy === 0)) return;
    this.#commandHistory.execute(new NudgePointsCommand([...pointIds], dx, dy));
  }

  public upgradeLineToCubic(segment: Segment): void {
    this.#commandHistory.execute(new UpgradeLineToCubicCommand(segment.raw as LineSegment));
  }

  public applyBooleanOp(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): void {
    const before = this.#bridge.getSnapshot();
    this.#bridge.applyBooleanOp(contourIdA, contourIdB, operation);
    const after = this.#bridge.getSnapshot();
    this.#commandHistory.record(new SnapshotCommand(`Boolean ${operation}`, before, after));
  }

  private getPointAt(coords: Coordinates): Point | null {
    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    return glyph.getPointAt(coords.glyphLocal, this.hitRadius);
  }

  private getAnchorAt(
    coords: Coordinates,
  ): { id: AnchorId; name: string | null; x: number; y: number } | null {
    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    for (const anchor of glyph.anchors) {
      if (Vec2.dist(anchor, coords.glyphLocal) < this.hitRadius) {
        return { id: anchor.id, name: anchor.name, x: anchor.x, y: anchor.y };
      }
    }

    return null;
  }

  private getSegmentAt(coords: Coordinates): SegmentHitResult | null {
    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    let bestHit: SegmentHitResult | null = null;
    for (const { segment } of glyph.segments()) {
      const hit = segment.hitTest(coords.glyphLocal, this.hitRadius);
      if (hit && (!bestHit || hit.distance < bestHit.distance)) {
        bestHit = hit;
      }
    }
    return bestHit;
  }

  /**
   * Performs a prioritized hit-test at a position (given as Coordinates).
   *
   * Priority order: contour endpoint > middle point > anchor > any point > segment.
   * Returns `null` if nothing is within `hitRadius`.
   */
  public hitTest(coords: Coordinates): HitResult {
    const endpoint = this.getContourEndpointAt(coords);

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

    const middle = this.getMiddlePointAt(coords);
    if (middle) return middle;

    const anchor = this.getAnchorAt(coords);
    if (anchor) {
      return { type: "anchor", anchorId: anchor.id };
    }

    const point = this.getPointAt(coords);
    if (point) {
      return { type: "point", point, pointId: point.id };
    }

    const segmentHit = this.getSegmentAt(coords);
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

  /**
   * Hit-tests for the start or end point of an open contour.
   * Used by the pen tool to detect when the user clicks an endpoint to close
   * or extend a contour.
   */
  private getContourEndpointAt(coords: Coordinates): ContourEndpointHit | null {
    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    for (const contour of glyph.contours) {
      if (contour.closed || contour.points.length === 0) continue;

      const firstPoint = contour.points[0];
      const lastPoint = contour.points[contour.points.length - 1];

      if (Vec2.dist(firstPoint, coords.glyphLocal) < this.hitRadius) {
        return {
          type: "contourEndpoint",
          contourId: contour.id,
          pointId: firstPoint.id,
          position: "start",
          contour,
        };
      }

      if (Vec2.dist(lastPoint, coords.glyphLocal) < this.hitRadius) {
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

  /**
   * Returns the axis-aligned bounding rect of the current committed selection
   * in UPM space, or `null` if fewer than two points are selected or the
   * selection is still in preview mode.
   */
  public getSelectionBoundingRect(): Rect2D | null {
    const glyph = this.#$glyph.value;
    const selectedPointIds = this.selection.$pointIds.peek();
    const selectionMode = this.selection.$mode.peek();

    if (!glyph || selectionMode !== "committed" || selectedPointIds.size <= 1) {
      return null;
    }

    const points = glyph.points([...selectedPointIds]);
    if (points.length <= 1) return null;

    const bounds = Bounds.fromPoints(points);
    if (!bounds) return null;

    return Bounds.toRect(bounds);
  }

  /**
   * Runs the full hover resolution pipeline at a position (given as Coordinates)
   * and applies the result to the hover manager. Checks bounding box handles
   * first (when multi-selected), then points, then segments.
   */
  public updateHover(coords: Coordinates): void {
    this.#hover.applyHoverResult(this.resolveHover(coords));
  }

  private resolveHover(coords: Coordinates): HoverResult {
    if (this.selection.$pointIds.peek().size > 1) {
      const bbHit = this.hitTestBoundingBoxAt(coords);
      if (bbHit) return { type: "boundingBox", handle: bbHit };
    }

    const hit = this.hitTest(coords);
    if (!hit) return { type: "none" };

    switch (hit.type) {
      case "point":
        return { type: "point", pointId: hit.pointId };
      case "contourEndpoint":
      case "middlePoint":
        return { type: "point", pointId: hit.pointId };
      case "anchor":
        return { type: "anchor", anchorId: hit.anchorId };
      case "segment":
        return {
          type: "segment",
          segmentId: hit.segmentId,
          closestPoint: hit.closestPoint,
          t: hit.t,
        };
    }
  }

  public getAllPoints(): Point[] {
    const glyph = this.#$glyph.value;
    if (!glyph) return [];

    return glyph.allPoints;
  }

  public duplicateSelection(): PointId[] {
    const glyph = this.#$glyph.value;
    if (!glyph) return [];

    const selectedPointIds = [...this.selection.pointIds];
    const selectedSegmentIds = [...this.selection.segmentIds];

    const content = resolveClipboardContent(
      glyph,
      new Set(selectedPointIds),
      new Set(selectedSegmentIds),
    );
    if (!content || content.contours.length === 0) return [];

    const result = this.#bridge.pasteContours(content.contours, 0, 0);
    return result.success ? result.createdPointIds : [];
  }

  public getSegmentById(segmentId: SegmentId) {
    return this.#$segmentIndex.value.get(segmentId) ?? null;
  }

  /**
   * Hit-tests for an interior point of an open contour (not first or last).
   * Skips the active contour and closed contours. Used by the pen tool to
   * detect mid-contour clicks for splitting or joining.
   */
  private getMiddlePointAt(coords: Coordinates): MiddlePointHit | null {
    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    const activeContourId = this.getActiveContourId();
    const hitRadius = this.hitRadius;

    for (const contour of glyph.contours) {
      if (contour.id === activeContourId || contour.closed) continue;
      if (!Contours.hasInteriorPoints(contour)) continue;

      for (let i = 1; i < contour.points.length - 1; i++) {
        const point = contour.points[i];
        if (Vec2.dist(coords.glyphLocal, point) < hitRadius) {
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

  public get drawOffset(): Point2D {
    return this.#drawOffset.value;
  }

  /** @knipclassignore */
  public get $drawOffset(): Signal<Point2D> {
    return this.#drawOffset;
  }

  public setDrawOffsetForGlyph(
    offset: Point2D,
    glyphName: string | null,
    unicode: number | null = null,
  ): void {
    this.#drawOffset.set(this.#resolveEditorPlacementOffset(offset, glyphName, unicode));
  }

  /** @knipclassignore Indirectly consumed through Viewport. */
  public setDrawOffset(offset: Point2D): void {
    this.#drawOffset.set(offset);
  }

  public requestRedraw() {
    this.#renderer.requestRedraw();
  }

  public requestSceneRedraw() {
    this.#renderer.requestSceneRedraw();
  }

  public requestOverlayRedraw() {
    this.#renderer.requestOverlayRedraw();
  }

  public requestImmediateRedraw() {
    this.#renderer.requestImmediateRedraw();
  }

  public cancelRedraw() {
    this.#renderer.cancelRedraw();
  }

  public destroy() {
    this.#events.emit("destroying");
    this.#staticEffect.dispose();
    this.#overlayEffect.dispose();
    this.#interactiveEffect.dispose();
    this.#cursorEffect.dispose();
    this.#renderer.destroy();
    this.#events.dispose();
  }

  #toolStateKey(toolId: string, key: string): string {
    return `${toolId}:${key}`;
  }

  #resolveEditorPlacementOffset(
    offset: Point2D,
    glyphName: string | null,
    unicode: number | null,
  ): Point2D {
    if (!glyphName || !isNonSpacingGlyph(glyphName, unicode)) {
      return offset;
    }

    const current = this.#$glyph.peek();
    if (!current || current.name !== glyphName) {
      return offset;
    }

    const metrics = this.font.getMetrics();
    const targetX = 300;
    const targetYForAnchorName = (anchorName: string): number => {
      switch (anchorName) {
        case "top":
          return metrics.capHeight ?? metrics.ascender;
        case "bottom":
        case "ogonek":
          return 0;
        case "center":
        default:
          return (metrics.ascender + metrics.descender) / 2;
      }
    };

    const attachingAnchor = current.anchors.find((anchor) => {
      const name = anchor.name ?? "";
      return name.startsWith("_") && name.length > 1;
    });

    if (attachingAnchor) {
      const targetName = attachingAnchor.name!.slice(1);
      return {
        x: offset.x + (targetX - attachingAnchor.x),
        y: offset.y + (targetYForAnchorName(targetName) - attachingAnchor.y),
      };
    }

    const bounds = this.font.getBbox(glyphName);
    if (!bounds) {
      return offset;
    }

    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerY = (bounds.min.y + bounds.max.y) / 2;
    return {
      x: offset.x + (targetX - centerX),
      y: offset.y + ((metrics.ascender + metrics.descender) / 2 - centerY),
    };
  }

  #getToolScopeMap(scope: ToolStateScope): Map<string, unknown> {
    return this.#toolState[scope];
  }

  #bumpToolStateVersion(): void {
    this.#toolStateVersion.set(this.#toolStateVersion.peek() + 1);
  }
}
