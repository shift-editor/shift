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
  AnchorId,
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
import type { Coordinates } from "@/types/coordinates";

import { GlyphNamingService, ViewportManager } from "./managers";
import { FontEngine } from "@/engine";
import { glyphDataStore } from "@/store/GlyphDataStore";
import { getGlyphInfo } from "@/store/glyphInfo";
import { CommandHistory, SetLeftSidebearingCommand, SetRightSidebearingCommand } from "../commands";
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
import { ContentResolver } from "../clipboard";
import { ClipboardManager } from "./managers/ClipboardManager";
import { cursorToCSS } from "../styles/cursor";
import { BOUNDING_BOX_HANDLE_STYLES } from "../styles/style";
import { hitTestBoundingBox, isBoundingBoxVisibleAtZoom } from "../tools/select/boundingBoxHitTest";
import { pointInRect } from "../tools/select/utils";
import { SelectionManager, HoverManager, EdgePanManager } from "./managers";
import {
  CanvasCoordinator,
  type CanvasCoordinatorContext,
  type ViewportTransform,
} from "./rendering/CanvasCoordinator";
import type { FocusZone } from "@/types/focus";
import type { DebugOverlays } from "@shared/ipc/types";
import type { TemporaryToolOptions } from "@/types/editor";
import type { EditorAPI } from "../tools/core/EditorAPI";
import type { Font } from "./Font";
import type { DrawAPI } from "../tools/core/DrawAPI";
import type { Modifiers } from "../tools/core/GestureDetector";
import type { ToolRenderContext, ToolRenderLayer } from "../tools/core/ToolRenderContributor";
import type {
  DragSnapSession,
  DragSnapSessionConfig,
  RotateSnapSession,
  SnapIndicator,
} from "./snapping/types";
import { SnapManager } from "./managers/SnapManager";
import { FontManager } from "./managers/FontManager";
import { TextRunManager } from "./managers/TextRunManager";
import type { PersistedTextRun, TextRunState } from "./managers/TextRunManager";
import type { GlyphRef } from "@/lib/tools/text/layout";
import type { CompositeComponentsPayload } from "@shared/bridge/FontEngineAPI";
import type { ToolDescriptor, ToolShortcutEntry } from "@/types/tools";
import type { ToolStateScope } from "../tools/core/EditorAPI";
import { isLikelyNonSpacingGlyphRef } from "@/lib/utils/unicode";
import { deriveGlyphSidebearings, roundSidebearing } from "./sidebearings";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

export interface ShiftEditor extends EditorAPI, CanvasCoordinatorContext {}

/**
 * Central orchestrator for the glyph editing surface.
 *
 * Editor owns and wires together every subsystem: viewport (UPM/screen
 * transforms), selection, hover, command history, snapping, clipboard,
 * tool management, and rendering (via CanvasCoordinator). It implements
 * both `EditorAPI` (the facade tools interact with) and
 * `CanvasCoordinatorContext` (the data the renderer reads).
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
 */
export class Editor implements ShiftEditor {
  private $previewMode: WritableSignal<boolean>;
  private $handlesVisible: WritableSignal<boolean>;

  #selection: SelectionManager;
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
  #fontEngine: FontEngine;
  #glyphNaming: GlyphNamingService;
  #$glyph: ComputedSignal<Glyph | null>;
  #fontManager: FontManager;
  #staticEffect: Effect;
  #textRunGlyphRefreshEffect: Effect;
  #overlayEffect: Effect;
  #interactiveEffect: Effect;
  #cursorEffect: Effect;
  #clipboard: ClipboardManager;
  #textRunManager: TextRunManager;
  #mainGlyphUnicode: number | null = null;
  #$glyphFinderOpen: WritableSignal<boolean>;

  #previewSnapshot: GlyphSnapshot | null = null;
  #isInPreview: boolean = false;
  #zone: FocusZone = "canvas";
  #marqueePreviewPointIds: WritableSignal<Set<PointId> | null>;

  #drawOffset: WritableSignal<Point2D>;
  $renderState: ComputedSignal<RenderState>;
  $staticState: ComputedSignal<StaticRenderState>;
  $overlayState: ComputedSignal<OverlayRenderState>;
  $interactiveState: ComputedSignal<InteractiveRenderState>;
  private $cursor: WritableSignal<string>;
  #currentModifiers: WritableSignal<Modifiers>;
  #isHoveringNode: ComputedSignal<boolean>;
  #snapPreferences: WritableSignal<SnapPreferences>;
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
  constructor() {
    this.#viewport = new ViewportManager();
    this.#fontEngine = new FontEngine();
    const glyphInfo = getGlyphInfo();
    this.#glyphNaming = new GlyphNamingService({
      getExistingGlyphNameForUnicode: (unicode) =>
        this.#fontEngine.info.getGlyphNameForUnicode(unicode),
      getMappedGlyphName: (unicode) => glyphInfo.getGlyphName(unicode),
    });
    this.#$glyph = computed<Glyph | null>(() => this.#fontEngine.$glyph.value as Glyph | null);
    this.#fontManager = new FontManager({
      getMetrics: () => this.#fontEngine.info.getMetrics(),
      getMetadata: () => this.#fontEngine.info.getMetadata(),
      getSvgPathByName: (glyphName) => glyphDataStore.getSvgPathByName(glyphName),
      getSvgPath: (unicode) => glyphDataStore.getSvgPath(unicode),
      getAdvanceByName: (glyphName) => glyphDataStore.getAdvanceByName(glyphName),
      getAdvance: (unicode) => glyphDataStore.getAdvance(unicode),
      getBboxByName: (glyphName) => glyphDataStore.getBboxByName(glyphName),
      getBbox: (unicode) => glyphDataStore.getBbox(unicode),
    });
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

    this.#selection = new SelectionManager();
    this.#hover = new HoverManager();
    this.#edgePan = new EdgePanManager(this);
    this.#snapManager = new SnapManager({
      getGlyph: () => this.#$glyph.value,
      getMetrics: () => this.#fontManager.getMetrics(),
      getSnapPreferences: () => this.#snapPreferences.value,
      screenToUpmDistance: (px) => this.#viewport.screenToUpmDistance(px),
    });
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

    this.#toolManager = new ToolManager(this);
    this.#renderer = new CanvasCoordinator(this);
    this.#clipboard = new ClipboardManager(this);
    this.#textRunManager = new TextRunManager();

    this.#drawOffset = signal<Point2D>({ x: 0, y: 0 });
    this.$renderState = computed<RenderState>(() => ({
      glyph: this.#$glyph.value,
      drawOffset: this.#drawOffset.value,
      selectedPointIds: this.#selection.selectedPointIds.value,
      selectedAnchorIds: this.#selection.selectedAnchorIds.value,
      selectedSegmentIds: this.#selection.selectedSegmentIds.value,
      hoveredPointId: this.#hover.hoveredPointId.value,
      hoveredAnchorId: this.#hover.hoveredAnchorId.value,
      hoveredSegmentId: this.#hover.hoveredSegmentId.value,
      selectionMode: this.#selection.selectionMode.value,
      previewMode: this.$previewMode.value,
    }));

    this.$staticState = computed<StaticRenderState>(() => ({
      glyph: this.#$glyph.value,
      drawOffset: this.#drawOffset.value,
      selectedPointIds: this.#selection.selectedPointIds.value,
      selectedAnchorIds: this.#selection.selectedAnchorIds.value,
      selectedSegmentIds: this.#selection.selectedSegmentIds.value,
      selectionMode: this.#selection.selectionMode.value,
      previewMode: this.$previewMode.value,
      handlesVisible: this.$handlesVisible.value,
      hoveredPointId: this.#hover.hoveredPointId.value,
      hoveredAnchorId: this.#hover.hoveredAnchorId.value,
      hoveredSegmentId: this.#hover.hoveredSegmentId.value,
      hoveredBoundingBoxHandle: this.#hover.hoveredBoundingBoxHandle.value,
      debugOverlays: this.#debugOverlays.value,
    }));

    this.$overlayState = computed<OverlayRenderState>(() => ({
      glyph: this.#$glyph.value,
      drawOffset: this.#drawOffset.value,
      selectedSegmentIds: this.#selection.selectedSegmentIds.value,
      hoveredPointId: this.#hover.hoveredPointId.value,
      hoveredAnchorId: this.#hover.hoveredAnchorId.value,
      hoveredSegmentId: this.#hover.hoveredSegmentId.value,
      snapIndicator: this.#snapIndicator.value,
    }));

    this.$interactiveState = computed<InteractiveRenderState>(() => ({
      activeToolState: this.$activeToolState.value,
    }));

    this.#staticEffect = effect(() => {
      this.$staticState.value;
      this.#textRunManager.state.value;
      this.#renderer.requestStaticRedraw();
    });

    this.#textRunGlyphRefreshEffect = effect(() => {
      const glyph = this.#$glyph.value;
      if (!glyph) return;

      const textRun = this.#textRunManager.state.peek();
      if (!textRun) return;

      const glyphInfo = getGlyphInfo();
      const unicodes = new Set<number>();
      const glyphNames = new Set<string>();
      for (const slot of textRun.layout.slots) {
        if (slot.glyph.unicode !== null) {
          unicodes.add(slot.glyph.unicode);
        }
        glyphNames.add(slot.glyph.glyphName);
      }
      unicodes.add(glyph.unicode);
      glyphNames.add(glyph.name);

      const nativeDependents = this.#fontEngine.info.getDependentUnicodesByName(glyph.name);
      for (const unicode of nativeDependents) {
        unicodes.add(unicode);
        const glyphName = this.#fontEngine.info.getGlyphNameForUnicode(unicode);
        if (glyphName) {
          glyphNames.add(glyphName);
        }
      }

      if (nativeDependents.length === 0) {
        // Fallback from Unicode decomposition graph when native dependency data is unavailable.
        for (const unicode of glyphInfo.getUsedBy(glyph.unicode)) {
          if (glyphDataStore.hasGlyph(unicode)) {
            unicodes.add(unicode);
          }
        }
      }

      for (const unicode of unicodes) {
        glyphDataStore.invalidateGlyph(unicode);
      }
      for (const glyphName of glyphNames) {
        glyphDataStore.invalidateGlyphByName(glyphName);
      }

      this.#textRunManager.recompute(this.#fontManager);
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
    this.#toolMetadata.set(id, { icon, tooltip, shortcut });
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

  public renderTool(draw: DrawAPI): void {
    this.#toolManager.render(draw);
  }

  public renderToolBelowHandles(draw: DrawAPI): void {
    this.#toolManager.renderBelowHandles(draw);
  }

  public renderToolContributors(
    layer: ToolRenderLayer,
    context: Omit<ToolRenderContext, "editor">,
  ): void {
    this.#toolManager.renderContributors(layer, context);
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

  public get selectedAnchorIds(): Signal<ReadonlySet<AnchorId>> {
    return this.#selection.selectedAnchorIds;
  }

  public selectPoints(pointIds: PointId[]): void {
    this.#selection.selectPoints(pointIds);
  }

  public selectAnchors(anchorIds: AnchorId[]): void {
    this.#selection.selectAnchors(anchorIds);
  }

  public addPointToSelection(pointId: PointId): void {
    this.#selection.addPointToSelection(pointId);
  }

  public addAnchorToSelection(anchorId: AnchorId): void {
    this.#selection.addAnchorToSelection(anchorId);
  }

  public removePointFromSelection(pointId: PointId): void {
    this.#selection.removePointFromSelection(pointId);
  }

  public removeAnchorFromSelection(anchorId: AnchorId): void {
    this.#selection.removeAnchorFromSelection(anchorId);
  }

  public togglePointSelection(pointId: PointId): void {
    this.#selection.togglePointSelection(pointId);
  }

  public toggleAnchorSelection(anchorId: AnchorId): void {
    this.#selection.toggleAnchorSelection(anchorId);
  }

  public isPointSelected(pointId: PointId): boolean {
    return this.#selection.isPointSelected(pointId);
  }

  public isAnchorSelected(anchorId: AnchorId): boolean {
    return this.#selection.isAnchorSelected(anchorId);
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

  public getSelectedAnchors(): AnchorId[] {
    return [...this.#selection.selectedAnchorIds.peek()];
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

  public getSnapPreferences(): SnapPreferences {
    return this.#snapPreferences.value;
  }

  public get snapPreferences(): Signal<SnapPreferences> {
    return this.#snapPreferences;
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

  public getSnapIndicator(): SnapIndicator | null {
    return this.#snapIndicator.peek();
  }

  public get debugOverlays(): Signal<DebugOverlays> {
    return this.#debugOverlays;
  }

  public get toolStateVersion(): Signal<number> {
    return this.#toolStateVersion;
  }

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
      this.#selection.isPointSelected(id) || this.isPointInMarqueePreview(id);
    return this.#hover.getPointVisualState(pointId, isSelected);
  }

  public getAnchorVisualState(anchorId: AnchorId): VisualState {
    if (this.#selection.isAnchorSelected(anchorId)) {
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

  /** Opens a glyph for editing by canonical glyph reference. */
  public startEditSession(glyph: GlyphRef): void {
    const glyphName = glyph.glyphName;
    const currentGlyphName = this.#fontEngine.session.getEditingGlyphName();
    if (currentGlyphName === glyphName) {
      this.#textRunManager.recompute(this.#fontManager);
      return;
    }

    this.#fontEngine.session.startEditSession(glyph);
    this.#fontEngine.editing.addContour();
    this.#textRunManager.recompute(this.#fontManager);
  }

  public endEditSession(): void {
    this.#fontEngine.session.endEditSession();
  }

  public get textRunManager(): TextRunManager {
    return this.#textRunManager;
  }

  public getTextRunState(): TextRunState | null {
    return this.#textRunManager.state.value;
  }

  public getTextRunLength(): number {
    return this.#textRunManager.buffer.length;
  }

  public ensureTextRunSeed(glyph: GlyphRef | null): void {
    this.#textRunManager.ensureSeeded(glyph);
  }

  public setTextRunCursorVisible(visible: boolean): void {
    this.#textRunManager.setCursorVisible(visible);
  }

  public setTextRunEditingSlot(index: number | null, glyph?: GlyphRef | null): void {
    this.#textRunManager.setEditingSlot(index, glyph);
  }

  public resetTextRunEditingContext(): void {
    this.#textRunManager.resetEditingContext();
  }

  public setTextRunHovered(index: number | null): void {
    this.#textRunManager.setHovered(index);
  }

  public setTextRunInspectionSlot(index: number | null): void {
    this.#textRunManager.setInspectionSlot(index);
  }

  public setTextRunInspectionComponent(index: number | null): void {
    this.#textRunManager.setInspectionHoveredComponent(index);
  }

  public clearTextRunInspection(): void {
    this.#textRunManager.clearInspection();
  }

  public insertTextCodepoint(codepoint: number): void {
    const glyphName = this.#fontEngine.info.getGlyphNameForUnicode(codepoint);
    if (!glyphName) return;
    this.#textRunManager.buffer.insert({
      glyphName,
      unicode: codepoint,
    });
  }

  public insertTextGlyphAt(index: number, glyph: GlyphRef): void {
    this.#textRunManager.insertGlyphAt(index, glyph);
  }

  public getTextRunCodepoints(): number[] {
    return this.#textRunManager.buffer
      .getText()
      .map((ref) => ref.unicode)
      .filter((unicode): unicode is number => unicode !== null);
  }

  public deleteTextCodepoint(): boolean {
    return this.#textRunManager.buffer.delete();
  }

  public moveTextCursorLeft(): boolean {
    return this.#textRunManager.buffer.moveLeft();
  }

  public moveTextCursorRight(): boolean {
    return this.#textRunManager.buffer.moveRight();
  }

  public moveTextCursorToEnd(): void {
    this.#textRunManager.buffer.moveTo(this.#textRunManager.buffer.length);
  }

  public recomputeTextRun(originX?: number): void {
    this.#textRunManager.recompute(this.#fontManager, originX);
  }

  public shouldRenderEditableGlyph(): boolean {
    const state = this.#textRunManager.state.peek();
    return !state || state.editingIndex !== null;
  }

  public getGlyphCompositeComponents(glyphName: string): CompositeComponentsPayload | null {
    return this.#fontEngine.info.getGlyphCompositeComponents(glyphName);
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

  public exportTextRuns(): Record<string, PersistedTextRun> {
    return this.#textRunManager.exportRuns();
  }

  public hydrateTextRuns(runsByGlyph: Record<string, PersistedTextRun>): void {
    this.#textRunManager.hydrateRuns(runsByGlyph);
    this.#textRunManager.recompute(this.#fontManager);
  }

  public get font(): Font {
    return this.#fontManager;
  }

  public get glyph(): Signal<Glyph | null> {
    return this.#$glyph;
  }

  public getActiveGlyphUnicode(): number | null {
    return this.#fontEngine.session.getEditingUnicode();
  }

  public getActiveGlyphName(): string | null {
    return this.#fontEngine.session.getEditingGlyphName();
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
    this.#textRunManager.setOwnerGlyph(glyphRef);
    this.#textRunManager.recompute(this.#fontManager);
  }

  public getMainGlyphUnicode(): number | null {
    return this.#mainGlyphUnicode;
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

  public get glyphFinderOpen(): Signal<boolean> {
    return this.#$glyphFinderOpen;
  }

  public openGlyphFinder(): void {
    this.#$glyphFinderOpen.set(true);
  }

  public closeGlyphFinder(): void {
    this.#$glyphFinderOpen.set(false);
  }

  public get isInPreview(): boolean {
    return this.#isInPreview;
  }

  public undo() {
    if (this.#isInPreview) {
      this.cancelPreview();
      return;
    }
    this.#commandHistory.undo();
  }

  public redo() {
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

  public get xAdvance(): number {
    return this.glyph.value?.xAdvance ?? 0;
  }

  public getVisualGlyphAdvance(glyph: Glyph): number {
    if (glyph.xAdvance > 0) return glyph.xAdvance;
    const unicode = Number.isFinite(glyph.unicode) ? glyph.unicode : null;
    if (!isLikelyNonSpacingGlyphRef(glyph.name, unicode)) {
      return glyph.xAdvance;
    }
    return 600;
  }

  public setXAdvance(width: number): void {
    this.beginPreview();
    this.#fontEngine.editing.setXAdvance(width);
    this.commitPreview("Set X Advance");
  }

  public setLeftSidebearing(value: number): void {
    const glyph = this.#$glyph.value;
    if (!glyph) return;

    const sidebearings = deriveGlyphSidebearings(glyph);
    if (sidebearings.lsb === null) return;

    const current = roundSidebearing(sidebearings.lsb);
    const target = roundSidebearing(value);
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

    const current = roundSidebearing(sidebearings.rsb);
    const target = roundSidebearing(value);
    const delta = target - current;
    if (delta === 0) return;

    const beforeXAdvance = glyph.xAdvance;
    const afterXAdvance = beforeXAdvance + delta;

    this.#commandHistory.execute(new SetRightSidebearingCommand(beforeXAdvance, afterXAdvance));
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

  public projectScreenToScene(x: number, y: number): Point2D {
    return this.#viewport.projectScreenToScene(x, y);
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

  public projectSceneToScreen(x: number, y: number): Point2D {
    return this.#viewport.projectSceneToScreen(x, y);
  }

  public fromScreen(sx: number, sy: number): Coordinates {
    const scene = this.projectScreenToScene(sx, sy);
    const glyphLocal = this.sceneToGlyphLocal(scene);
    return { screen: { x: sx, y: sy }, scene, glyphLocal };
  }

  public fromScene(x: number, y: number): Coordinates {
    const scene = { x, y };
    const screen = this.projectSceneToScreen(x, y);
    const glyphLocal = this.sceneToGlyphLocal(scene);
    return { screen, scene, glyphLocal };
  }

  public fromGlyphLocal(x: number, y: number): Coordinates {
    const glyphLocal = { x, y };
    const scene = this.glyphLocalToScene(glyphLocal);
    const screen = this.projectSceneToScreen(scene.x, scene.y);
    return { screen, scene, glyphLocal };
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
    if (this.#fontEngine.session.isActive()) {
      this.#fontEngine.session.endEditSession();
    }
    this.#fontEngine.io.loadFont(filePath);
    const unicodes = this.#fontEngine.info.getGlyphUnicodes();
    const metrics = this.#fontEngine.info.getMetrics();
    glyphDataStore.onFontLoaded(unicodes, metrics);
    this.#commandHistory.clear();
    this.#textRunManager.clearAll();
    this.setMainGlyphUnicode(65);
    const glyphRef = this.glyphRefFromUnicode(65);
    this.startEditSession(glyphRef);
    this.setDrawOffsetForGlyph({ x: 0, y: 0 }, glyphRef);
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
    return this.#clipboard.copy();
  }

  public async cut(): Promise<boolean> {
    return this.#clipboard.cut();
  }

  public async paste(): Promise<void> {
    return this.#clipboard.paste();
  }

  /**
   * Captures a glyph snapshot and enters preview mode.
   *
   * While in preview, tools can mutate the glyph freely. Call `commitPreview()`
   * to record the changes as a single undoable command, or `cancelPreview()`
   * to restore the snapshot. No-op if already in preview.
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

  /** @param angle - Rotation in radians. */
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
      x,
      y,
      pointType: type,
      smooth,
    });
  }

  public movePoints(ids: PointId[], dx: number, dy: number): void {
    this.#fontEngine.editing.movePoints(ids, { x: dx, y: dy });
  }

  public moveAnchors(ids: AnchorId[], delta: Point2D): void {
    this.#fontEngine.editing.moveAnchors(ids, delta);
  }

  public movePointTo(id: PointId, x: number, y: number): void {
    this.#fontEngine.editing.movePointTo(id, x, y);
  }

  public applySmartEdits(ids: readonly PointId[], dx: number, dy: number): PointId[] {
    return this.#fontEngine.editing.applySmartEdits(new Set(ids), dx, dy);
  }

  public setNodePositions(updates: NodePositionUpdateList): void {
    this.#fontEngine.editing.setNodePositions(updates);
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

  public getPointAt(coords: Coordinates): Point | null {
    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    return Glyphs.getPointAt(glyph, coords.glyphLocal, this.hitRadius);
  }

  public getAnchorAt(
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

  public getSegmentAt(coords: Coordinates): SegmentHitResult | null {
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
  public getNodeAt(coords: Coordinates): HitResult {
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
  public getContourEndpointAt(coords: Coordinates): ContourEndpointHit | null {
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
    const selectedPoints = this.getSelectedPoints();
    if (selectedPoints.length <= 1) return null;

    if (this.getSelectionMode() !== "committed") return null;

    const points = selectedPoints
      .map((id) => this.getPointById(id))
      .filter((p): p is Point => p !== null);

    if (points.length === 0) return null;

    return Polygon.boundingRect(points);
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
    if (this.getSelectedPoints().length > 1) {
      const bbHit = this.hitTestBoundingBoxAt(coords);
      if (bbHit) {
        return { type: "boundingBox", handle: bbHit };
      }
    }

    // Keep hover precedence aligned with getNodeAt() for click/drag consistency.
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

    const selectedPointIds = this.getSelectedPoints();
    const selectedSegmentIds = this.getSelectedSegments();

    const resolver = new ContentResolver();
    const content = resolver.resolve(glyph, selectedPointIds, selectedSegmentIds);
    if (!content || content.contours.length === 0) return [];

    const result = this.#fontEngine.editing.pasteContours(content.contours, 0, 0);
    return result.success ? result.createdPointIds : [];
  }

  public getSegmentById(segmentId: SegmentId) {
    const glyph = this.#$glyph.value;
    if (!glyph) return null;

    for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
      if (Segment.id(segment) === segmentId) {
        return segment;
      }
    }
    return null;
  }

  /**
   * Hit-tests for an interior point of an open contour (not first or last).
   * Skips the active contour and closed contours. Used by the pen tool to
   * detect mid-contour clicks for splitting or joining.
   */
  public getMiddlePointAt(coords: Coordinates): MiddlePointHit | null {
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

  public getDrawOffset(): Point2D {
    return this.#drawOffset.value;
  }

  public setDrawOffsetForGlyph(offset: Point2D, glyph: GlyphRef | null): void {
    this.#drawOffset.set(this.#resolveEditorPlacementOffset(offset, glyph));
  }

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
    this.#staticEffect.dispose();
    this.#textRunGlyphRefreshEffect.dispose();
    this.#overlayEffect.dispose();
    this.#interactiveEffect.dispose();
    this.#cursorEffect.dispose();
    this.#renderer.destroy();
  }

  #toolStateKey(toolId: string, key: string): string {
    return `${toolId}:${key}`;
  }

  #resolveEditorPlacementOffset(offset: Point2D, glyph: GlyphRef | null): Point2D {
    if (!glyph || !isLikelyNonSpacingGlyphRef(glyph.glyphName, glyph.unicode)) {
      return offset;
    }

    const current = this.#$glyph.peek();
    if (!current || current.name !== glyph.glyphName) {
      return offset;
    }

    const metrics = this.#fontManager.getMetrics();
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

    const bounds = this.#fontManager.getBboxByName?.(glyph.glyphName);
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
