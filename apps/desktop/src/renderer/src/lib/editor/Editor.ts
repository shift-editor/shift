import type { CursorType, ToolRegistryItem } from "@/types/editor";
import type {
  PointId,
  ContourId,
  Source,
  SourceId,
  GlyphName,
  GlyphRecord,
  ItemId,
} from "@shift/types";
import type { AxisLocation } from "@/types/variation";
import type { Coordinates } from "@/types/coordinates";
import type { Glyph, GlyphInstance, GlyphLayer } from "@/lib/model/Glyph";
import {
  axisLocationFromLocation,
  cloneAxisLocation,
  emptyAxisLocation,
} from "@/lib/variation/location";
import type { ToolName, ActiveToolState } from "../tools/core";
import { ToolManager } from "../tools/core/ToolManager";
import { Segment } from "@shift/glyph-state";
import { Bounds, Point2D, Rect2D } from "@shift/geo";

import { Camera } from "./managers";
import {
  CommandRunner,
  SetLeftSidebearingCommand,
  SetRightSidebearingCommand,
  SetXAdvanceCommand,
  NudgePointsCommand,
  ReverseContourCommand,
  SplitSegmentCommand,
  UpgradeLineToCubicCommand,
  BooleanOperationCommand,
  CutCommand,
  PasteCommand,
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
  batch,
  computed,
  effect,
  signal,
  type Effect,
  type Signal,
  type WritableSignal,
} from "../signals/signal";
import {
  Clipboard,
  ClipboardContent,
  ClipboardSelection,
  type SystemClipboard,
} from "../clipboard";
import { cursorToCSS } from "../styles/cursor";
import { EdgePanManager } from "./managers";
import { Hover } from "./Hover";
import { Renderer } from "./rendering/Renderer";
import type { Canvas2DSurface, MarkerCanvasSurface } from "./rendering/CanvasSurface";
import type { CameraTransform } from "./managers";
import type { FocusZone } from "@/types/focus";
import type { DebugOverlays } from "@/types/uiState";
import type { TemporaryToolOptions } from "@/types/editor";
import { Selection } from "./Selection";
import type { Font } from "../model/Font";
import type { Modifiers } from "../tools/core/GestureDetector";
import { TextRuns } from "@/lib/text/TextRuns";
import { TextRun, type FocusedGlyph } from "@/lib/text/TextRun";
import { glyphTextItem, Positioner } from "@/lib/text/layout";
import type { GlyphAnchor } from "@/lib/text/layout";

import type { ToolManifest, ToolShortcutEntry } from "@/types/tools";
import type { ToolStateScope } from "@/types/editor";
import { EventEmitter } from "./lifecycle";

import type { LineSegmentPoints } from "@shift/glyph-state";
import { Contour } from "@shift/glyph-state";
import { GlyphLayerEditDraft, type GlyphLayerEditSubject } from "./GlyphLayerEditDraft";
import { Scene } from "./Scene";
import {
  EditorGlyphState,
  EditorGesture,
  GlyphDisplay,
  EditorInput,
  EditorViewState,
  TextEditingState,
  type GlyphDisplayState,
  type GlyphPlacement,
} from "./EditorState";

interface EditorOptions {
  font: Font;
  clipboard: SystemClipboard;
}

/**
 * Central orchestrator for the glyph editing surface.
 *
 * Editor owns and wires together every subsystem: camera (UPM/screen
 * transforms), selection, hover, command history, clipboard,
 * tool management, and rendering (via Renderer). It is passed
 * directly to tools and behaviors.
 *
 * Subsystems communicate through reactive signals. Effects watch composite
 * render-state signals and schedule redraws on the appropriate canvas layer
 * (static, overlay, interactive) when their dependencies change.
 *
 * Typical lifecycle:
 * 1. Construct the Editor (creates all managers and wires signals).
 * 2. Register tools via `registerTool()`.
 * 3. Call `setActiveTool()` to begin interaction.
 * 4. Call `destroy()` on teardown to dispose effects and the renderer.
 *
 * Font state arrives through the injected `Font` projection; there is no
 * load call on the editor.
 *
 * @knipclassignore
 */
export class Editor {
  /**
   * User-facing editor display toggles.
   *
   * These are session preferences for how the active glyph is presented. They
   * are not glyph data and should eventually live behind an `EditorViewState`
   * object so rendering code can consume them as one named concept.
   */
  #view: EditorViewState;

  /**
   * Long-lived editor model objects.
   *
   * `Selection` and `Hover` are mutable runtime state. `Font` owns document
   * glyph/source models. Geometry remains immutable and is read through the
   * explicit surfaces below.
   */
  readonly selection: Selection;
  readonly hover: Hover;
  readonly font: Font;
  readonly scene: Scene;

  /**
   * Rendering and camera infrastructure.
   *
   * The drawer instances are stateless-ish rendering helpers. They currently
   * live directly on `Editor`, but the render passes below would be easier to
   * reason about if these moved behind a small `EditorRenderer` facade.
   */
  #renderer: Renderer;
  #edgePan: EdgePanManager;

  #toolManager: ToolManager;
  #toolMetadata: Map<
    ToolName,
    {
      icon: React.FC<React.SVGProps<SVGSVGElement>>;
      tooltip: string;
      shortcut?: string;
    }
  >;
  #activeTool: WritableSignal<ToolName>;
  #activeToolState: WritableSignal<ActiveToolState>;
  #isEditing: Signal<boolean>;

  /**
   * Runtime services with lifecycle or side effects.
   *
   * These mutate process/editor state: camera, command history, bridge IO,
   * event dispatch, and registered tool state. They should stay separate from
   * immutable glyph geometry and from render-only state.
   */
  #camera: Camera;
  #commands: CommandRunner;

  /**
   * Active glyph/source context.
   *
   * `edit` resolves the authored glyph layer backing commands and mutation.
   * `preview` is the displayed/interpolated glyph used by rendering and hit
   * queries.
   */
  #glyph: EditorGlyphState;
  #designLocation: WritableSignal<AxisLocation>;

  #cursorEffect: Effect;
  #cameraMetricsEffect: Effect;

  #clipboard: Clipboard;

  #events: EventEmitter;

  #textRuns: TextRuns;

  #glyphFinderOpen: WritableSignal<boolean>;

  #zone: FocusZone = "canvas";

  /**
   * Text-run focus and placement.
   *
   * Text editing uses the same camera and glyph rendering surface, but this
   * state is conceptually its own subsystem. It is a good candidate for a
   * `TextEditingSession` or `TextRunController` grouping.
   */
  #text: TextEditingState;
  readonly gesture: EditorGesture;
  #glyphDisplay: GlyphDisplay;
  readonly input: EditorInput;
  #toolState: {
    app: Map<string, unknown>;
    document: Map<string, unknown>;
  };

  /**
   * Initializes all subsystems, wires signal dependencies, and sets up
   * reactive effects that schedule canvas redraws when state changes.
   *
   */
  constructor(options: EditorOptions) {
    this.#camera = new Camera();

    this.font = options.font;
    this.scene = new Scene();
    this.#designLocation = signal(emptyAxisLocation(), { name: "editor.designLocation" });
    this.#glyph = new EditorGlyphState(this.font, this.scene, this.#designLocation);

    this.#view = new EditorViewState();
    this.input = new EditorInput();
    this.gesture = new EditorGesture();

    this.#commands = new CommandRunner(this.#glyph.layerEditing.glyphLayer);

    this.#toolState = {
      app: new Map<string, unknown>(),
      document: new Map<string, unknown>(),
    };

    this.#glyphFinderOpen = signal(false, { name: "editor.glyphFinder.open" });

    this.selection = new Selection(this.#glyph.layerEditing.glyphLayer);
    this.hover = new Hover();

    this.#edgePan = new EdgePanManager(this);

    this.#toolMetadata = new Map();
    this.#activeTool = signal<ToolName>("select", {
      name: "editor.tool.active",
    });
    this.#activeToolState = signal<ActiveToolState>(
      { type: "idle" },
      {
        name: "editor.tool.state",
      },
    );
    this.#events = new EventEmitter();
    this.#toolManager = new ToolManager(this);
    this.#isEditing = computed(
      () => this.#toolManager.activeToolCell.value?.isEditingCell.value ?? false,
      { name: "editor.isEditing" },
    );

    this.#clipboard = new Clipboard(options.clipboard);

    this.#textRuns = new TextRuns(this.font, new Positioner(), this.#designLocation);
    this.#text = new TextEditingState(this.#textRuns);
    this.#glyphDisplay = new GlyphDisplay(this.#text, this.#textRuns);

    this.#renderer = new Renderer(this);

    this.#cameraMetricsEffect = effect(
      () => {
        this.font.$loaded.value;
        this.updateMetricsFromFont();
      },
      { name: "editor.cameraMetrics" },
    );

    this.#cursorEffect = effect(
      () => {
        const activeTool = this.#toolManager.activeToolCell.value;
        if (activeTool) {
          this.setCursor(activeTool.cursorCell.value);
          return;
        }

        this.setCursor({ type: "default" });
      },
      { name: "editor.cursor" },
    );
  }

  public registerTool(descriptor: ToolManifest): void {
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

  public get activeTool(): ToolName {
    return this.#activeTool.peek();
  }

  public get activeToolCell(): Signal<ToolName> {
    return this.#activeTool;
  }

  // oxlint-disable-next-line shift/no-get-signal-value-method -- retained for upcoming tool refactor
  public getActiveTool(): ToolName {
    return this.#activeTool.peek();
  }

  /**
   * Typed as `ActiveToolState` (which is `any`) because each tool defines its
   * own state shape. Consumers should narrow the type based on `activeTool`.
   */
  public get activeToolState(): ActiveToolState {
    return this.#activeToolState.peek();
  }

  public get activeToolStateCell(): Signal<ActiveToolState> {
    return this.#activeToolState;
  }

  public get isEditing(): boolean {
    return this.#isEditing.peek();
  }

  public get isEditingCell(): Signal<boolean> {
    return this.#isEditing;
  }

  // oxlint-disable-next-line shift/no-get-signal-value-method -- retained for upcoming tool refactor
  public getActiveToolState(): ActiveToolState {
    return this.#activeToolState.peek();
  }

  public setActiveToolState(state: ActiveToolState): void {
    this.#activeToolState.set(state);
  }

  public setActiveTool(toolName: ToolName): void {
    const currentToolName = this.#activeTool.peek();
    if (currentToolName === toolName) return;

    this.toolManager.activate(toolName);
    this.#activeTool.set(toolName);
  }

  public get toolManager(): ToolManager {
    return this.#toolManager;
  }

  public requestTemporaryTool(toolId: ToolName, options?: TemporaryToolOptions): void {
    this.toolManager.requestTemporary(toolId, options);
  }

  public returnFromTemporaryTool(): void {
    this.toolManager.returnFromTemporary();
  }

  public get currentModifiers(): Modifiers {
    return this.input.modifiers;
  }

  public get currentModifiersCell(): Signal<Modifiers> {
    return this.input.modifiersCell;
  }

  public setCurrentModifiers(modifiers: Modifiers): void {
    this.input.setModifiers(modifiers);
  }

  public beginGlyphLayerEditDraft(subject: GlyphLayerEditSubject): GlyphLayerEditDraft {
    const glyphLayer = this.#glyph.layerEditing.glyphLayer.peek();
    if (!glyphLayer) {
      throw new Error("Cannot begin a glyph layer edit draft without an authored glyph layer");
    }

    return new GlyphLayerEditDraft(glyphLayer, subject);
  }

  public get debugOverlays(): DebugOverlays {
    return this.#view.debugOverlaysCell.peek();
  }

  public get debugOverlaysCell(): Signal<DebugOverlays> {
    return this.#view.debugOverlaysCell;
  }

  public setDebugOverlays(overlays: DebugOverlays): void {
    this.#view.debugOverlaysCell.set(overlays);
  }

  public get proofMode(): boolean {
    return this.#glyphDisplay.proofMode;
  }

  public get proofModeCell(): Signal<boolean> {
    return this.#glyphDisplay.proofModeCell;
  }

  /**
   * Sets whether the focused glyph is drawn as filled proof artwork.
   *
   * @param enabled - `true` to show proof artwork and suppress edit handles.
   */
  public setProofMode(enabled: boolean): void {
    this.#glyphDisplay.setProofMode(enabled);
  }

  /** Enables proof rendering for the active glyph. */
  public enableProofMode(): void {
    this.setProofMode(true);
  }

  /** Disables proof rendering for the active glyph. */
  public disableProofMode(): void {
    this.setProofMode(false);
  }

  public get handlesVisible(): boolean {
    return this.#glyphDisplay.handlesVisible;
  }

  public get handlesVisibleCell(): Signal<boolean> {
    return this.#glyphDisplay.handlesVisibleCell;
  }

  /**
   * Sets whether point handles and structured geometry controls are visible.
   *
   * @param visible - `true` to draw handles for focused glyph instances.
   */
  public setHandlesVisible(visible: boolean): void {
    this.#glyphDisplay.setHandlesVisible(visible);
  }

  /** Shows point handles and structured geometry controls. */
  public showHandles(): void {
    this.setHandlesVisible(true);
  }

  /** Hides point handles and structured geometry controls. */
  public hideHandles(): void {
    this.setHandlesVisible(false);
  }

  /**
   * Display state for the active glyph in the editor canvas.
   *
   * @returns A snapshot combining glyph display toggles and text-focus visibility.
   */
  public get glyphDisplay(): GlyphDisplayState {
    return this.#glyphDisplay.cell.peek();
  }

  /** Reactive display state for render layers and canvas items. */
  public get glyphDisplayCell(): Signal<GlyphDisplayState> {
    return this.#glyphDisplay.cell;
  }

  public setBackgroundSurface(surface: Canvas2DSurface): void {
    this.#renderer.setBackgroundSurface(surface);
  }

  public setSceneSurface(surface: Canvas2DSurface): void {
    this.#renderer.setSceneSurface(surface);
  }

  public setOverlaySurface(surface: Canvas2DSurface): void {
    this.#renderer.setOverlaySurface(surface);
  }

  public setMarkerSurface(surface: MarkerCanvasSurface): void {
    this.#renderer.setMarkerSurface(surface);
  }

  public clearMarkerCanvas(): void {
    this.#renderer.clearMarkerCanvas();
  }

  /**
   * Creates an empty glyph in the loaded font.
   *
   * @param name - Preferred glyph name. Existing names are auto-incremented.
   * @returns The record for the glyph that was actually created.
   * @see {@link Font.createGlyph}
   */
  public createGlyph(name: GlyphName): GlyphRecord {
    return this.font.createGlyph(name);
  }

  /**
   * Focus a glyph item and derive editor placement from current layout.
   *
   *   GlyphAnchor { runId, itemId }
   *      │
   *      ▼
   *   TextRuns.resolveAnchor(anchor)
   *      │
   *      ▼
   *   source glyph geometry + drawOffset = focused.editOrigin
   */
  public setGlyphFocus(anchor: GlyphAnchor): void {
    const focused = this.#textRuns.resolveAnchor(anchor);
    if (!focused) {
      this.clearGlyphFocus();
      return;
    }

    batch(() => {
      this.#text.glyphAnchor.set(anchor);
      const record = this.font.recordForName(focused.glyph.name);
      if (record) this.font.requestGlyphs([record.id]);
      this.disableProofMode();
    });
  }

  public clearGlyphFocus(): void {
    this.#text.glyphAnchor.set(null);
  }

  public get focusedGlyph(): FocusedGlyph | null {
    return this.#text.focusedGlyph.peek();
  }

  public get focusedGlyphCell(): Signal<FocusedGlyph | null> {
    return this.#text.focusedGlyph;
  }

  public get glyphPlacement(): GlyphPlacement | null {
    return this.#text.glyphPlacement.peek();
  }

  /** Clears the current glyph focus and active contour selection. */
  public close(): void {
    this.scene.clear();
    this.#glyph.active.activeContourId.set(null);
  }

  public get $designLocation(): Signal<AxisLocation> {
    return this.#designLocation;
  }

  /** Current designspace coordinate used for displayed glyph data. */
  public get designLocation(): AxisLocation {
    return this.#designLocation.peek();
  }

  /**
   * Reactive ID of the designspace source selected for layer editing.
   *
   * `null` means the current design location does not exactly match a source.
   */
  public get $layerSourceId(): Signal<SourceId | null> {
    return this.#glyph.layerEditing.sourceId;
  }

  /** ID of the exact designspace source at the current location, or `null`. */
  public get layerSourceId(): SourceId | null {
    return this.#glyph.layerEditing.sourceId.peek();
  }

  /** Font source currently selected for layer editing, or `null` when unavailable. */
  public get layerSource(): Source | null {
    return this.#glyph.layerEditing.selectedSource.peek();
  }

  /**
   * Returns the authored glyph layer currently mutated by edit commands.
   *
   * @remarks
   * This is the layer model for an exact source, not interpolated preview
   * geometry. Clipboard, command, and test code should use this when reading
   * or mutating authored point data.
   *
   * @returns null when no authored glyph layer is available.
   */
  public get editingGlyphLayer(): GlyphLayer | null {
    return this.#glyph.layerEditing.glyphLayer.peek();
  }

  /** Glyph instance resolved at the current design location. */
  public get glyphInstance(): GlyphInstance | null {
    return this.#glyph.preview.instance.peek();
  }

  /**
   * Set the displayed designspace coordinate shared by editor views.
   */
  public setDesignLocation(location: AxisLocation): void {
    this.#designLocation.set(cloneAxisLocation(location));
  }

  /**
   * Select every point in the active authored glyph layer.
   *
   * This intentionally uses the authored glyph layer rather than interpolated
   * design-location geometry: selection mutates an authored layer, so it must
   * refer to point IDs that commands can mutate.
   */
  public selectAll(): void {
    const instance = this.glyphInstance;
    if (!instance?.layer) return;

    this.selection.select(
      instance.geometry.allPoints.map((point) => ({
        kind: "point",
        id: point.id,
      })),
    );
    return;
  }

  /**
   * Select an authored glyph layer for editing and move the display location to it.
   *
   * Missing source IDs are ignored. This does not open a glyph; it moves the
   * shared design location to the source.
   */
  public selectLayerSource(sourceId: SourceId): void {
    const source = this.font.source(sourceId);
    if (!source) return;

    this.setDesignLocation(axisLocationFromLocation(source.location));
  }

  /**
   * Return the shared design location to the font default.
   */
  public clearLayerSourceSelection(): void {
    this.setDesignLocation(this.font.defaultLocation());
  }

  public get textRuns(): TextRuns {
    return this.#textRuns;
  }

  /** The currently-active text run. Convenience for `editor.textRuns.active`. */
  public get textRun(): TextRun {
    return this.#textRuns.active;
  }

  /** Resolve a unicode codepoint to a glyph item and insert into the active text run. */
  public insertTextCodepoint(codepoint: number): void {
    const handle = this.font.glyphHandleForUnicode(codepoint);
    if (!handle) return;
    const record = this.font.recordForName(handle.name);
    if (record) this.font.requestGlyphs([record.id]);
    this.textRun.insert(glyphTextItem(handle.name, codepoint));
  }

  /** @knipclassignore Indirectly consumed through Renderer. */
  public focusedGlyphVisible(): boolean {
    return this.#glyphDisplay.cell.peek().focusedGlyphVisible;
  }

  public getToolState(scope: ToolStateScope, toolId: string, key: string): unknown {
    return this.#getToolScopeMap(scope).get(this.#toolStateKey(toolId, key));
  }

  public setToolState(scope: ToolStateScope, toolId: string, key: string, value: unknown): void {
    const scopedState = this.#getToolScopeMap(scope);
    const stateKey = this.#toolStateKey(toolId, key);
    if (scopedState.get(stateKey) === value) return;
    scopedState.set(stateKey, value);
  }

  public deleteToolState(scope: ToolStateScope, toolId: string, key: string): void {
    const scopedState = this.#getToolScopeMap(scope);
    const stateKey = this.#toolStateKey(toolId, key);
    if (!scopedState.delete(stateKey)) return;
  }

  public get glyph(): Signal<Glyph | null> {
    return this.#glyph.active.glyph;
  }

  public get glyphInstanceCell(): Signal<GlyphInstance | null> {
    return this.#glyph.preview.instance;
  }

  public glyphForItem(itemId: ItemId): Glyph | null {
    const item = this.scene.glyphItem(itemId);
    if (!item) return null;

    return this.font.glyphForId(item.glyphId);
  }

  public instanceForItem(itemId: ItemId): GlyphInstance | null {
    const item = this.scene.glyphItem(itemId);
    const glyph = item ? this.glyphForItem(itemId) : null;
    if (!item || !glyph) return null;
    return glyph.instance(this.#designLocation);
  }

  public layerForItem(itemId: ItemId): GlyphLayer | null {
    const item = this.scene.glyphItem(itemId);
    if (!item) return null;
    const source = this.font.sourceAt(this.designLocation);
    if (!source) return null;
    return this.font.glyphLayerForId(item.glyphId, source.id);
  }

  /** Stateless command executor; undo authority is the workspace ledger. */
  public get commands(): CommandRunner {
    return this.#commands;
  }

  /** Subscribe to a lifecycle event. Returns an unsubscribe function. */
  public on: EventEmitter["on"] = (...args) => this.#events.on(...args);

  public updateEdgePan(screenPos: Point2D, canvasBounds: Rect2D): void {
    this.#edgePan.update(screenPos, canvasBounds);
  }

  public stopEdgePan(): void {
    this.#edgePan.stop();
  }

  public getFocusZone(): FocusZone {
    return this.#zone;
  }

  public get camera(): Camera {
    return this.#camera;
  }

  public setZone(zone: FocusZone): void {
    this.#zone = zone;
  }

  public get glyphFinderOpen(): boolean {
    return this.#glyphFinderOpen.peek();
  }

  public get glyphFinderOpenCell(): Signal<boolean> {
    return this.#glyphFinderOpen;
  }

  public openGlyphFinder(): void {
    this.#glyphFinderOpen.set(true);
  }

  public closeGlyphFinder(): void {
    this.#glyphFinderOpen.set(false);
  }

  public undo() {
    // One undo authority: the workspace ledger (state-pair replay).
    void this.font.editCoordinator.undo();
  }

  public redo() {
    void this.font.editCoordinator.redo();
  }

  public setCameraRect(rect: Rect2D) {
    this.#camera.setRect(rect);
  }

  public setCameraUpm(upm: number) {
    this.#camera.upm = upm;
  }

  public get xAdvance(): number {
    return this.glyphInstance?.xAdvance ?? 0;
  }

  /**
   * Sets the active glyph layer's horizontal advance through command history.
   *
   * @param width - New advance width in UPM units.
   */
  public setXAdvance(width: number): void {
    const instance = this.glyphInstance;
    if (!instance?.layer) return;

    if (instance.xAdvance === width) return;

    this.#commands.run(new SetXAdvanceCommand(width));
  }

  /**
   * Sets the active glyph layer's left sidebearing by translating its outline.
   *
   * @param value - Desired left sidebearing in UPM units.
   */
  public setLeftSidebearing(value: number): void {
    const instance = this.glyphInstance;
    if (!instance?.layer) return;

    const bbox = instance.render.outline.bounds;
    if (!bbox) return;

    const delta = Math.round(value) - Math.round(bbox.min.x);
    if (delta === 0) return;

    this.#commands.run(new SetLeftSidebearingCommand(instance.xAdvance + delta, delta));
  }

  /**
   * Sets the active glyph layer's right sidebearing by changing its advance.
   *
   * @param value - Desired right sidebearing in UPM units.
   */
  public setRightSidebearing(value: number): void {
    const instance = this.glyphInstance;
    if (!instance?.layer) return;

    const bbox = instance.render.outline.bounds;
    if (!bbox) return;

    const currentRsb = instance.xAdvance - bbox.max.x;
    const delta = Math.round(value) - Math.round(currentRsb);
    if (delta === 0) return;

    this.#commands.run(new SetRightSidebearingCommand(instance.xAdvance + delta));
  }

  public updateMetricsFromFont(): void {
    const metrics = this.font.metrics;
    this.#camera.upm = metrics.unitsPerEm;
    this.#camera.descender = metrics.descender;
  }

  public get screenMousePositionCell(): Signal<Point2D> {
    return this.#camera.screenMousePositionCell;
  }

  public getMousePosition(): Point2D {
    return this.#camera.mousePosition;
  }

  public getScreenMousePosition(): Point2D {
    return this.#camera.screenMousePosition;
  }

  public updateMousePosition(clientX: number, clientY: number): void {
    this.#camera.updateMousePosition(clientX, clientY);
  }

  public flushMousePosition(): void {
    this.#camera.flushMousePosition();
  }

  public get pointerCoords(): Signal<Coordinates | null> {
    return this.input.pointerCell;
  }

  public projectScreenToScene(screen: Point2D): Point2D {
    return this.#camera.projectScreenToScene(screen.x, screen.y);
  }

  public sceneToGlyphLocal(point: Point2D): Point2D {
    const offset = this.drawOffset;
    return { x: point.x - offset.x, y: point.y - offset.y };
  }

  public glyphLocalToScene(point: Point2D): Point2D {
    const offset = this.drawOffset;
    return { x: point.x + offset.x, y: point.y + offset.y };
  }

  public get hitRadius(): number {
    return this.#camera.hitRadius;
  }

  /** @knipclassignore Indirectly consumed through Renderer. */
  public screenToUpmDistance(pixels: number): number {
    return this.#camera.screenToUpmDistance(pixels);
  }

  /** @knipclassignore Indirectly consumed through Renderer. */
  public getCameraTransform(): CameraTransform {
    return {
      zoom: this.#camera.zoomLevel,
      panX: this.#camera.panX,
      panY: this.#camera.panY,
      centre: this.#camera.centre,
      upmScale: this.#camera.upmScale,
      logicalHeight: this.#camera.logicalHeight,
      layoutHeight: this.#camera.layoutHeight,
      padding: this.#camera.padding,
      descender: this.#camera.descender,
    };
  }

  /** @knipclassignore Indirectly consumed through Renderer. */
  public projectSceneToScreen(scene: Point2D): Point2D {
    return this.#camera.projectSceneToScreen(scene.x, scene.y);
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
    return this.#camera.pan;
  }

  public setPan(pan: Point2D): void {
    this.#camera.setPan(pan.x, pan.y);
  }

  public zoomIn(): void {
    this.#camera.zoomIn();
  }

  public zoomOut(): void {
    this.#camera.zoomOut();
  }

  public zoomToPoint(screenX: number, screenY: number, zoomDelta: number): void {
    this.#camera.zoomToPoint(screenX, screenY, zoomDelta);
  }

  public setCursor(cursor: CursorType): void {
    this.#view.cursorCell.set(cursorToCSS(cursor));
  }

  public get cursor(): string {
    return this.#view.cursorCell.peek();
  }

  public get cursorCell(): Signal<string> {
    return this.#view.cursorCell;
  }

  public get zoom(): number {
    return this.#camera.zoomLevel;
  }

  public get zoomCell(): Signal<number> {
    return this.#camera.zoomCell;
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

  /** Deletes currently selected points from the active authored glyph layer. */
  public deleteSelectedPoints(): void {
    const edit = this.glyphInstance?.layer;
    if (!edit) return;

    const selectedIds = [...this.selection.pointIds];
    if (selectedIds.length > 0) {
      edit.removePoints(selectedIds);
      this.selection.clear();
    }
  }

  public async copy(): Promise<boolean> {
    const content = this.#selectedClipboardContent();
    if (!content || content.contours.length === 0) return false;

    const glyph = this.glyph.peek();
    if (!glyph) return false;

    return this.#clipboard.write(content, { sourceGlyph: glyph.name });
  }

  public async cut(): Promise<boolean> {
    const content = this.#selectedClipboardContent();
    if (!content || content.contours.length === 0) return false;

    const glyph = this.glyph.peek();
    if (!glyph) return false;

    const written = await this.#clipboard.write(content, {
      sourceGlyph: glyph.name,
    });
    if (!written) return false;

    const pointIds = this.#selectedClipboardPointIds();
    this.#commands.run(new CutCommand(pointIds));
    this.selection.clear();

    return true;
  }

  public async paste(): Promise<void> {
    const result = await this.#clipboard.read();
    if (result.kind !== "glyph" || result.content.contours.length === 0) return;

    this.selection.clear();
    const command = new PasteCommand(result.content, {
      offset: this.#clipboard.nextPasteOffset(),
    });
    this.#commands.run(command);

    if (command.createdPointIds.length > 0) {
      this.selection.select(command.createdPointIds.map((id) => ({ kind: "point", id })));
    }
  }

  #selectionCenter(): Point2D | null {
    const bounds = this.selection.bounds;
    return bounds ? Bounds.center(bounds) : null;
  }

  #selectedClipboardContent(): ClipboardContent | null {
    const source = this.#glyph.layerEditing.glyphLayer.peek();
    if (!source) return null;

    const selection = ClipboardSelection.fromSelection(this.selection);
    if (selection.pointIds.length === 0) return null;

    return selection.contentFrom(source);
  }

  #selectedClipboardPointIds(): PointId[] {
    const selection = ClipboardSelection.fromSelection(this.selection);
    if (selection.pointIds.length === 0) return [];

    return [...selection.pointIds];
  }

  /** @param angle - Rotation in radians. */
  public rotateSelection(angle: number, origin?: Point2D): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const center = origin ?? this.#selectionCenter();
    if (!center) return;

    const cmd = new RotatePointsCommand([...pointIds], angle, center);
    this.#commands.run(cmd);
  }

  public scaleSelection(sx: number, sy: number, origin?: Point2D): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const o = origin ?? this.#selectionCenter();
    if (!o) return;

    const cmd = new ScalePointsCommand([...pointIds], sx, sy, o);
    this.#commands.run(cmd);
  }

  public reflectSelection(axis: ReflectAxis, origin?: Point2D): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const center = origin ?? this.#selectionCenter();
    if (!center) return;

    const cmd = new ReflectPointsCommand([...pointIds], axis, center);
    this.#commands.run(cmd);
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
    this.#commands.run(cmd);
  }

  public alignSelection(alignment: AlignmentType): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length === 0) return;

    const cmd = new AlignPointsCommand([...pointIds], alignment);
    this.#commands.run(cmd);
  }

  public distributeSelection(type: DistributeType): void {
    const pointIds = [...this.selection.pointIds];
    if (pointIds.length < 3) return;

    const cmd = new DistributePointsCommand([...pointIds], type);
    this.#commands.run(cmd);
  }

  public get activeContourIdCell(): Signal<ContourId | null> {
    return this.#glyph.active.activeContourId;
  }

  public getActiveContourId(): ContourId | null {
    const id = this.#glyph.active.activeContourId.peek();
    if (!id) return null;

    return id;
  }

  public setActiveContour(contourId: ContourId | null): void {
    this.#glyph.active.activeContourId.set(contourId);
  }

  public clearActiveContour(): void {
    this.#glyph.active.activeContourId.set(null);
  }

  public getActiveContour(): Contour | null {
    const activeContourId = this.getActiveContourId();
    if (!activeContourId) return null;

    return this.glyphInstance?.geometry.contour(activeContourId) ?? null;
  }

  public continueContour(contourId: ContourId, fromStart: boolean, pointId: PointId): void {
    this.#glyph.active.activeContourId.set(contourId);
    if (fromStart) {
      this.#commands.run(new ReverseContourCommand(contourId));
    }
    this.selection.select([{ kind: "point", id: pointId }]);
  }

  public splitSegment(segment: Segment, t: number): PointId {
    return this.#commands.run(new SplitSegmentCommand(segment, t));
  }

  public scalePoints(pointIds: readonly PointId[], sx: number, sy: number, anchor: Point2D): void {
    if (pointIds.length === 0 || (sx === 1 && sy === 1)) return;
    this.#commands.run(new ScalePointsCommand([...pointIds], sx, sy, anchor));
  }

  public rotatePoints(pointIds: readonly PointId[], angle: number, center: Point2D): void {
    if (pointIds.length === 0 || angle === 0) return;
    this.#commands.run(new RotatePointsCommand([...pointIds], angle, center));
  }

  public nudgePoints(pointIds: readonly PointId[], dx: number, dy: number): void {
    if (pointIds.length === 0 || (dx === 0 && dy === 0)) return;
    this.#commands.run(new NudgePointsCommand([...pointIds], dx, dy));
  }

  public upgradeLineToCubic(segment: LineSegmentPoints): void {
    this.#commands.run(new UpgradeLineToCubicCommand(segment));
  }

  public boolean(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): void {
    this.#commands.run(new BooleanOperationCommand(contourIdA, contourIdB, operation));
  }

  public duplicateSelection(): PointId[] {
    const content = this.#selectedClipboardContent();
    if (!content || content.contours.length === 0) return [];

    const command = new PasteCommand(content, { offset: { x: 0, y: 0 } });
    this.#commands.run(command);
    return command.createdPointIds;
  }

  public get drawOffset(): Point2D {
    return this.#text.drawOffset.peek();
  }

  /** @knipclassignore */
  public get $drawOffset(): Signal<Point2D> {
    return this.#text.drawOffset;
  }

  public destroy() {
    this.#events.emit("destroying");
    this.#cursorEffect.dispose();
    this.#cameraMetricsEffect.dispose();
    this.#renderer.destroy();
    this.#events.dispose();
  }

  #toolStateKey(toolId: string, key: string): string {
    return `${toolId}:${key}`;
  }

  #getToolScopeMap(scope: ToolStateScope): Map<string, unknown> {
    return this.#toolState[scope];
  }
}
