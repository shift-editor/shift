import type { IGraphicContext } from "@/types/graphics";
import type { HandleState } from "@/types/graphics";
import { ReglHandleContext } from "@/lib/graphics/backends/ReglHandleContext";
import type { CursorType, SnapPreferences, ToolRegistryItem, VisualState } from "@/types/editor";
import type { Point2D, Rect2D, PointId, AnchorId, ContourId, Contour, Point } from "@shift/types";
import type { Glyph } from "@/lib/model/glyph";
import type { ToolName, ActiveToolState } from "../tools/core";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { HitResult, MiddlePointHit, ContourEndpointHit, HoverResult } from "@/types/hitResult";
import { ToolManager } from "../tools/core/ToolManager";
import { SnapshotCommand } from "../commands/primitives/SnapshotCommand";
import { Segment, type SegmentHitResult } from "../geo/Segment";
import { Bounds, Vec2 } from "@shift/geo";
import { Contours, Glyphs } from "@shift/font";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { Coordinates } from "@/types/coordinates";

import { GlyphNamingService, ViewportManager } from "./managers";
import { NativeBridge } from "@/bridge";
import { getGlyphInfo } from "@/store/glyphInfo";
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
import { Clipboard, resolveClipboardContent } from "../clipboard";
import { cursorToCSS } from "../styles/cursor";
import { BOUNDING_BOX_HANDLE_STYLES } from "../styles/style";
import { hitTestBoundingBox, isBoundingBoxVisibleAtZoom } from "../tools/select/boundingBoxHitTest";
import { pointInRect } from "../tools/select/utils";
import { HoverManager, EdgePanManager } from "./managers";
import {
  CanvasCoordinator,
  type CanvasCoordinatorContext,
  type ViewportTransform,
} from "./rendering/CanvasCoordinator";
import type { FocusZone } from "@/types/focus";
import type { DebugOverlays } from "@shared/ipc/types";
import type { TemporaryToolOptions } from "@/types/editor";
import { Selection } from "@/types/selection";
import { Font } from "./Font";
import type { DrawAPI } from "../tools/core/DrawAPI";
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
import type { GlyphRef } from "@/lib/tools/text/layout";
import type { CompositeGlyph } from "@shift/types";
import type { ToolDescriptor, ToolShortcutEntry } from "@/types/tools";
import type { ToolStateScope } from "@/types/editor";
import { isLikelyNonSpacingGlyphRef } from "@/lib/utils/unicode";
import { deriveGlyphSidebearings, roundSidebearing } from "./sidebearings";
import { EventEmitter } from "./lifecycle";
import { StateRegistry, type ShiftState, type ShiftStateOptions } from "@/lib/state/ShiftState";

import type { Segment as GlyphSegment, LineSegment } from "@/types/segments";
import type { GlyphDraft } from "@/types/draft";

/**
 * Central orchestrator for the glyph editing surface.
 *
 * Editor owns and wires together every subsystem: viewport (UPM/screen
 * transforms), selection, hover, command history, snapping, clipboard,
 * tool management, and rendering (via CanvasCoordinator). It implements
 * `CanvasCoordinatorContext` (the data the renderer reads) and is passed
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
export class Editor implements CanvasCoordinatorContext {
  private $previewMode: WritableSignal<boolean>;
  private $handlesVisible: WritableSignal<boolean>;
  private $gpuHandlesEnabled: WritableSignal<boolean>;

  readonly selection: Selection;
  readonly font: Font;
  #hover: HoverManager;
  #renderer: CanvasCoordinator;
  #edgePan: EdgePanManager;
  #snapManager: SnapManager;

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
  #glyphNaming: GlyphNamingService;
  #$glyph: ComputedSignal<Glyph | null>;

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
  private $cursor: WritableSignal<string>;
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
    const glyphInfo = getGlyphInfo();
    this.#glyphNaming = new GlyphNamingService({
      getExistingGlyphNameForUnicode: (unicode) => this.font.nameForUnicode(unicode),
      getMappedGlyphName: (unicode) => glyphInfo.getGlyphName(unicode),
    });
    this.#$glyph = computed<Glyph | null>(() => this.#bridge.$glyph.value as Glyph | null);
    this.#commandHistory = new CommandHistory(this.#$glyph);

    this.$previewMode = signal(false);
    this.$cursor = signal("default");
    this.$handlesVisible = signal(true);
    this.$gpuHandlesEnabled = signal(true);
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
    this.#renderer = new CanvasCoordinator(this);
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
      this.#$glyph.value;
      this.#drawOffset.value;
      this.selection.pointIds;
      this.selection.anchorIds;
      this.selection.segmentIds;
      this.selection.mode;
      this.$previewMode.value;
      this.$handlesVisible.value;
      this.#hover.hoveredPointId.value;
      this.#hover.hoveredAnchorId.value;
      this.#hover.hoveredSegmentId.value;
      this.#hover.hoveredBoundingBoxHandle.value;
      this.#debugOverlays.value;
      this.$gpuHandlesEnabled.value;
      this.#textRunController.state.value;
      this.#renderer.requestStaticRedraw();
    });

    this.#overlayEffect = effect(() => {
      this.#$glyph.value;
      this.#drawOffset.value;
      this.selection.segmentIds;
      this.#hover.hoveredPointId.value;
      this.#hover.hoveredAnchorId.value;
      this.#hover.hoveredSegmentId.value;
      this.#hover.hoveredBoundingBoxHandle.value;
      this.$previewMode.value;
      this.$handlesVisible.value;
      this.#snapIndicator.value;
      this.#renderer.requestOverlayRedraw();
    });

    this.#interactiveEffect = effect(() => {
      this.$activeToolState.value;
      this.#renderer.requestInteractiveRedraw();
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

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public renderToolInScene(draw: DrawAPI): void {
    this.#toolManager.renderInScene(draw);
  }

  public renderTool(draw: DrawAPI): void {
    this.#toolManager.render(draw);
  }

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public renderToolBelowHandles(draw: DrawAPI): void {
    this.#toolManager.renderBelowHandles(draw);
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

  public get hoveredPointId(): Signal<PointId | null> {
    return this.#hover.hoveredPointId;
  }

  public get hoveredAnchorId(): Signal<AnchorId | null> {
    return this.#hover.hoveredAnchorId;
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

  public setHoveredAnchor(anchorId: AnchorId | null): void {
    this.#hover.setHoveredAnchor(anchorId);
  }

  public setHoveredSegment(indicator: SegmentIndicator | null): void {
    this.#hover.setHoveredSegment(indicator);
  }

  public setHoveredBoundingBoxHandle(handle: BoundingBoxHitResult): void {
    this.#hover.setHoveredBoundingBoxHandle(handle);
  }

  public hitTestBoundingBoxAt(coords: Coordinates): BoundingBoxHitResult {
    if (!isBoundingBoxVisibleAtZoom(this.getZoom())) return null;

    const rect = this.getSelectionBoundingRect();
    if (!rect) return null;

    const handleOffset = this.screenToUpmDistance(BOUNDING_BOX_HANDLE_STYLES.handle.offset);
    const rotationZoneOffset = this.screenToUpmDistance(
      BOUNDING_BOX_HANDLE_STYLES.rotationZoneOffset,
    );

    return hitTestBoundingBox(
      coords.glyphLocal,
      rect,
      this.hitRadius,
      handleOffset,
      rotationZoneOffset,
    );
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

  get settings(): AppSettings {
    return this.#settings.value;
  }

  public getSnapPreferences(): SnapPreferences {
    return this.settings.snap;
  }

  public setSnapPreferences(next: Partial<SnapPreferences>): void {
    const current = this.#settings.peek();
    this.#settings.set({
      ...current,
      snap: { ...current.snap, ...next },
    });
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

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public getSnapIndicator(): SnapIndicator | null {
    return this.#snapIndicator.peek();
  }

  public createDraft(): GlyphDraft {
    const glyph = this.#bridge.$glyph.peek();
    if (!glyph) {
      throw new Error("Cannot create draft without an active glyph");
    }

    const baseSnapshot = glyph.toSnapshot();
    let dirty = false;
    let finished = false;

    return {
      base: baseSnapshot,
      setPositions: (updates) => {
        if (finished) return;
        dirty = true;
        this.#bridge.setNodePositions(updates);
      },
      finish: (label) => {
        if (finished) return;
        finished = true;

        if (dirty) {
          this.#commandHistory.record(new SnapshotCommand(label, baseSnapshot, glyph.toSnapshot()));
        }
      },
      discard: () => {
        if (finished) return;
        finished = true;
        this.#bridge.restoreSnapshot(baseSnapshot);
      },
    };
  }

  public withBatch<TResult>(label: string, fn: () => TResult): TResult {
    return this.#commandHistory.withBatch(label, fn);
  }

  public get debugOverlays(): Signal<DebugOverlays> {
    return this.#debugOverlays;
  }

  public get toolStateVersion(): Signal<number> {
    return this.#toolStateVersion;
  }

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public getDebugOverlays(): DebugOverlays {
    return this.#debugOverlays.value;
  }

  public setDebugOverlays(overlays: DebugOverlays): void {
    this.#debugOverlays.set(overlays);
  }

  public getHoveredPoint(): PointId | null {
    return this.#hover.hoveredPointId.peek();
  }

  public getHoveredAnchor(): AnchorId | null {
    return this.#hover.hoveredAnchorId.peek();
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
      this.selection.isSelected({ kind: "point", id }) || this.isPointInMarqueePreview(id);
    return this.#hover.getPointVisualState(pointId, isSelected);
  }

  public getAnchorVisualState(anchorId: AnchorId): VisualState {
    if (this.selection.isSelected({ kind: "anchor", id: anchorId })) {
      return "selected";
    }
    if (this.#hover.hoveredAnchorId.value === anchorId) {
      return "hovered";
    }
    return "idle";
  }

  public isPointInMarqueePreview(pointId: PointId): boolean {
    const marqueePreviewPointIds = this.#marqueePreviewPointIds.peek();
    if (marqueePreviewPointIds == null) return false;

    return marqueePreviewPointIds.has(pointId);
  }

  public getSegmentVisualState(segmentId: SegmentId): VisualState {
    return this.#hover.getSegmentVisualState(segmentId, (id) =>
      this.selection.isSelected({ kind: "segment", id }),
    );
  }

  public get previewMode(): Signal<boolean> {
    return this.$previewMode;
  }

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
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

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public isHandlesVisible(): boolean {
    return this.$handlesVisible.peek();
  }

  public setHandlesVisible(visible: boolean): void {
    this.$handlesVisible.set(visible);
  }

  public get gpuHandlesEnabled(): Signal<boolean> {
    return this.$gpuHandlesEnabled;
  }

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public isGpuHandlesEnabled(): boolean {
    return this.$gpuHandlesEnabled.peek();
  }

  public setGpuHandlesEnabled(enabled: boolean): void {
    this.$gpuHandlesEnabled.set(enabled);
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

  public setGpuHandleContext(context: ReglHandleContext) {
    this.#renderer.setGpuHandleContext(context);
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

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
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

  public getActiveGlyphRef(): GlyphRef | null {
    const glyphName = this.getActiveGlyphName();
    if (!glyphName) return null;
    return {
      glyphName,
      unicode: this.getActiveGlyphUnicode(),
    };
  }

  public glyphRefFromUnicode(unicode: number): GlyphRef {
    return this.#glyphNaming.glyphRefFromUnicode(unicode);
  }

  public setMainGlyphUnicode(unicode: number | null): void {
    this.#mainGlyphUnicode = unicode;
    const glyphRef = unicode === null ? null : this.glyphRefFromUnicode(unicode);
    this.#textRunController.setOwnerGlyph(glyphRef);
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

  public get viewportManager(): ViewportManager {
    return this.#viewport;
  }

  public get bridge(): NativeBridge {
    return this.#bridge;
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

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public getVisualGlyphAdvance(glyph: Glyph): number {
    if (glyph.xAdvance > 0) return glyph.xAdvance;
    const unicode = Number.isFinite(glyph.unicode) ? glyph.unicode : null;
    if (!isLikelyNonSpacingGlyphRef(glyph.name, unicode)) {
      return glyph.xAdvance;
    }
    return 600;
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

    const sidebearings = deriveGlyphSidebearings(glyph);
    if (sidebearings.lsb === null) return;

    const current = roundSidebearing(sidebearings.lsb)!;
    const target = roundSidebearing(value)!;
    const delta = target - current;
    if (delta === 0) return;

    const beforeXAdvance = glyph.xAdvance;
    const afterXAdvance = beforeXAdvance + delta;

    this.#commandHistory.execute(
      new SetLeftSidebearingCommand(beforeXAdvance, afterXAdvance, delta),
    );
  }

  public setRightSidebearing(value: number): void {
    const glyph = this.#$glyph.value;
    if (!glyph) return;

    const sidebearings = deriveGlyphSidebearings(glyph);
    if (sidebearings.rsb === null) return;

    const current = roundSidebearing(sidebearings.rsb)!;
    const target = roundSidebearing(value)!;
    const delta = target - current;
    if (delta === 0) return;

    const beforeXAdvance = glyph.xAdvance;
    const afterXAdvance = beforeXAdvance + delta;

    this.#commandHistory.execute(new SetRightSidebearingCommand(beforeXAdvance, afterXAdvance));
  }

  public updateMetricsFromFont(): void {
    const metrics = this.font.getMetrics();
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

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public screenToUpmDistance(pixels: number): number {
    return this.#viewport.screenToUpmDistance(pixels);
  }

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
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

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
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

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public getHandleState(pointId: PointId): HandleState {
    return this.getPointVisualState(pointId);
  }

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public getAnchorHandleState(anchorId: AnchorId): HandleState {
    return this.getAnchorVisualState(anchorId);
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
    const ref = this.glyphRefFromUnicode(65);
    this.open(ref.glyphName);
    this.setDrawOffsetForGlyph({ x: 0, y: 0 }, ref);
  }

  public async saveFont(filePath: string): Promise<void> {
    return this.font.save(filePath);
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

  public getSelectionBounds(): Bounds | null {
    const glyph = this.#$glyph.value;
    const pointIds = this.selection.$pointIds.peek();
    if (!glyph || pointIds.size === 0) return null;
    return getSegmentAwareBounds(glyph, Array.from(pointIds));
  }

  public getSelectionCenter(): Point2D | null {
    const bounds = this.getSelectionBounds();
    if (!bounds) return null;
    return Bounds.center(bounds);
  }

  /** @param angle - Rotation in radians. */
  public rotateSelection(angle: number, origin?: Point2D): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const center = origin ?? this.getSelectionCenter();
    if (!center) return;

    const cmd = new RotatePointsCommand([...pointIds], angle, center);
    this.#commandHistory.execute(cmd);
  }

  public scaleSelection(sx: number, sy: number, origin?: Point2D): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const o = origin ?? this.getSelectionCenter();
    if (!o) return;

    const cmd = new ScalePointsCommand([...pointIds], sx, sy, o);
    this.#commandHistory.execute(cmd);
  }

  public reflectSelection(axis: ReflectAxis, origin?: Point2D): void {
    const pointIds = [...this.selection.pointIds];
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

  public getPointById(pointId: PointId): Point | null {
    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    return Glyphs.findPoint(glyph, pointId)?.point ?? null;
  }

  public getContourById(contourId: ContourId): Contour | null {
    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    return Glyphs.findContour(glyph, contourId) ?? null;
  }

  public getActiveContourId(): ContourId | null {
    const id = this.#bridge.getActiveContourId();
    if (id == null) return null;
    return id;
  }

  public getActiveContour(): Contour | null {
    const activeContourId = this.getActiveContourId();
    if (!activeContourId) return null;
    return this.getContourById(activeContourId);
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

  public splitSegment(segment: GlyphSegment, t: number): PointId {
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

  public upgradeLineToCubic(segment: LineSegment): void {
    this.#commandHistory.execute(new UpgradeLineToCubicCommand(segment));
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

    return Glyphs.getPointAt(glyph, coords.glyphLocal, this.hitRadius);
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
    for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
      const hit = Segment.hitTest(segment, coords.glyphLocal, this.hitRadius);
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

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;

    for (const contour of glyph.contours) {
      for (const point of contour.points) {
        if (!selectedPointIds.has(point.id)) continue;
        count += 1;
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }

    if (count <= 1) return null;

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      left: minX,
      top: minY,
      right: maxX,
      bottom: maxY,
    };
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
      if (bbHit) {
        return { type: "boundingBox", handle: bbHit };
      }
    }

    // Keep hover precedence aligned with hitTest() for click/drag consistency.
    const endpoint = this.getContourEndpointAt(coords);
    if (endpoint) {
      return { type: "point", pointId: endpoint.pointId };
    }

    const middle = this.getMiddlePointAt(coords);
    if (middle) {
      return { type: "point", pointId: middle.pointId };
    }

    const anchor = this.getAnchorAt(coords);
    if (anchor) {
      return { type: "anchor", anchorId: anchor.id };
    }

    const point = this.getPointAt(coords);
    if (point) {
      return { type: "point", pointId: point.id };
    }

    const segmentHit = this.getSegmentAt(coords);
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
    const glyph = this.#$glyph.value;
    if (!glyph) return [];

    return Glyphs.getAllPoints(glyph);
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
    const glyph = this.#$glyph.value;
    if (!glyph) return null;
    return this.#getSegmentIndex(glyph).get(segmentId) ?? null;
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

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public getDrawOffset(): Point2D {
    return this.#drawOffset.value;
  }

  public setDrawOffsetForGlyph(offset: Point2D, glyph: GlyphRef | null): void {
    this.#drawOffset.set(this.#resolveEditorPlacementOffset(offset, glyph));
  }

  /** @knipclassignore Indirectly consumed through CanvasCoordinatorContext. */
  public setDrawOffset(offset: Point2D): void {
    this.#drawOffset.set(offset);
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

  #getSegmentIndex(glyph: Glyph): ReadonlyMap<SegmentId, SegmentHitResult["segment"]> {
    const segmentsById = new Map<SegmentId, SegmentHitResult["segment"]>();
    for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
      segmentsById.set(Segment.id(segment), segment);
    }
    return segmentsById;
  }

  #resolveEditorPlacementOffset(offset: Point2D, glyph: GlyphRef | null): Point2D {
    if (!glyph || !isLikelyNonSpacingGlyphRef(glyph.glyphName, glyph.unicode)) {
      return offset;
    }

    const current = this.#$glyph.peek();
    if (!current || current.name !== glyph.glyphName) {
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

    const bounds = this.font.getBbox(glyph.glyphName);
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
