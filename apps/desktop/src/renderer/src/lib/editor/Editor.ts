import type { CursorType, ToolRegistryItem } from "@/types/editor";
import type { PointId, ContourId, Source, SourceId, GlyphName } from "@shift/types";
import type { AxisLocation } from "@/types/variation";
import type { Coordinates } from "@/types/coordinates";
import type { Glyph, GlyphInstance, GlyphSource } from "@/lib/model/Glyph";
import { axisLocationFromLocation, emptyAxisLocation } from "@/lib/variation/location";
import type { ToolName, ActiveToolState } from "../tools/core";
import { ToolManager } from "../tools/core/ToolManager";
import { Segment } from "@shift/glyph-state";
import { Bounds, Point2D, Rect2D } from "@shift/geo";

import { Camera } from "./managers";
import {
  CommandHistory,
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
import type { GlyphHandle } from "@shared/bridge/BridgeApi";
import type { DebugOverlays } from "@shared/ipc/types";
import type { TemporaryToolOptions } from "@/types/editor";
import { Selection } from "./Selection";
import { Font } from "../model/Font";
import type { Modifiers } from "../tools/core/GestureDetector";
import { TextRuns } from "@/lib/text/TextRuns";
import { TextRun, type FocusedGlyph } from "@/lib/text/TextRun";
import { glyphTextItem, Positioner } from "@/lib/text/layout";
import type { GlyphAnchor } from "@/lib/text/layout";

import type { ToolManifest, ToolShortcutEntry } from "@/types/tools";
import type { ToolStateScope } from "@/types/editor";
import { EventEmitter } from "./lifecycle";

import type { LineSegmentPoints } from "@shift/glyph-state";
import type { ShiftBridge } from "@shift/bridge";
import { Contour } from "@shift/glyph-state";
import { SourceEditDraft, type SourceEditSubject } from "./SourceEditDraft";
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
  bridge: ShiftBridge;
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
 * 2. Call `loadFont()` to open a font file and populate the glyph store.
 * 3. Register tools via `registerTool()`.
 * 4. Call `setActiveTool()` to begin interaction.
 * 5. Call `destroy()` on teardown to dispose effects and the renderer.
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

  /**
   * Runtime services with lifecycle or side effects.
   *
   * These mutate process/editor state: camera, command history, bridge IO,
   * event dispatch, and registered tool state. They should stay separate from
   * immutable glyph geometry and from render-only state.
   */
  #camera: Camera;
  #commandHistory: CommandHistory;
  #bridge: ShiftBridge;

  /**
   * Active glyph/source context.
   *
   * `edit` is the authored source backing commands and mutation.
   * `preview` is the displayed/interpolated glyph used by rendering and hit
   * queries.
   */
  #glyph: EditorGlyphState;

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

    this.#bridge = options.bridge;

    this.font = new Font(this.#bridge);
    this.#glyph = new EditorGlyphState(this.font);

    this.#view = new EditorViewState();
    this.input = new EditorInput();
    this.gesture = new EditorGesture();

    this.#commandHistory = new CommandHistory(this.#glyph.edit.glyphSource);

    this.#toolState = {
      app: new Map<string, unknown>(),
      document: new Map<string, unknown>(),
    };

    this.#glyphFinderOpen = signal(false, { name: "editor.glyphFinder.open" });

    this.selection = new Selection(this.#glyph.edit.glyphSource);
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

    this.#clipboard = new Clipboard(options.clipboard);

    this.#textRuns = new TextRuns(this.font, new Positioner(), this.#glyph.design.location);
    this.#text = new TextEditingState(this.#textRuns);
    this.#glyphDisplay = new GlyphDisplay(this.#text, this.#textRuns);

    this.#renderer = new Renderer(this);

    this.#events.on("fontLoaded", () => {
      this.#commandHistory.clear();
      this.#textRuns.clearAll();
    });

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

  public beginSourceEditDraft(subject: SourceEditSubject): SourceEditDraft {
    const glyphSource = this.#glyph.edit.glyphSource.peek();
    if (!glyphSource) {
      throw new Error("Cannot begin a source edit draft without an active glyph source");
    }

    return new SourceEditDraft(glyphSource, this.#commandHistory, subject);
  }

  public withBatch<TResult>(label: string, fn: () => TResult): TResult {
    return this.#commandHistory.withBatch(label, fn);
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
   * Sets whether the editable glyph is drawn as filled proof artwork.
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
   * Sets whether point handles and edit affordances are visible.
   *
   * @param visible - `true` to draw handles for editable glyph instances.
   */
  public setHandlesVisible(visible: boolean): void {
    this.#glyphDisplay.setHandlesVisible(visible);
  }

  /** Shows point handles and edit affordances. */
  public showHandles(): void {
    this.setHandlesVisible(true);
  }

  /** Hides point handles and edit affordances. */
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
   * Focus an existing glyph model in the editor.
   *
   * This is a read/focus API. It chooses the current active source context for
   * camera metrics, asks `Font` for existing glyph state, and updates
   * `editingGlyph` when the glyph can be loaded. It does not create missing
   * glyph data and does not select an editable source.
   *
   * @returns The focused glyph model, or `null` when the glyph has no readable state.
   */
  public getGlyph(handle: GlyphHandle): Glyph | null {
    const glyph = this.font.glyph(handle);
    if (!glyph) return null;

    this.#glyph.open.glyph.set(glyph);

    return glyph;
  }

  public setRootGlyphHandle(handle: GlyphHandle | null): void {
    this.#glyph.open.rootHandle.set(handle);
  }

  public get rootGlyphHandle(): GlyphHandle | null {
    return this.#glyph.open.rootHandle.peek();
  }

  public getActiveGlyphName(): string | null {
    return this.#glyph.open.glyph.peek()?.name ?? null;
  }

  /**
   * Start editing a glyph at an explicit source.
   *
   * This is the source-aware edit entry point. The `sourceId` must be explicit
   * so callers do not accidentally edit whatever source happens to be active in
   * the UI.
   *
   * @example
   * ```ts
   * const source = editor.font.sourceAtOrDefault(editor.font.defaultLocation())
   * editor.openGlyphSource(handle, source.id)
   * ```
   *
   * @returns The editable glyph source, or `null` when the source/glyph cannot be opened.
   */
  public openGlyphSource(handle: GlyphHandle, sourceId: SourceId): GlyphSource | null {
    this.setRootGlyphHandle(handle);
    const source = this.font.source(sourceId);
    if (!source) return null;

    this.#glyph.edit.selectSource(source.id);

    const glyph = this.getGlyph(handle);
    if (!glyph) return null;

    return this.font.glyphSource(handle, source);
  }

  /**
   * Open a glyph as the editor's root text run glyph.
   *
   * This updates text-run focus and returns the glyph model selected by the
   * resulting focus change. It is not the source-editing entry point; use
   * {@link openGlyphSource} when the caller wants editable source data.
   *
   * @returns The focused glyph model, or `null` when the glyph cannot be read.
   */
  public openGlyph(handle: GlyphHandle): Glyph | null {
    this.setRootGlyphHandle(handle);
    const runs = this.#textRuns.editorRun();
    const anchor = runs.setSingleGlyph(handle);
    this.setGlyphFocus(anchor);
    return this.#glyph.open.glyph.peek();
  }

  /**
   * Creates an empty committed glyph in the loaded font.
   *
   * @remarks
   * This is the editor-level entry point for quick-add flows. It delegates
   * naming and bridge commit semantics to {@link Font.createGlyph}.
   *
   * @param name - Preferred glyph name. Existing names are auto-incremented.
   * @returns The handle for the glyph that was actually created.
   */
  public createGlyph(name: GlyphName): GlyphHandle {
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
      this.getGlyph(focused.glyph);
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
    this.#glyph.open.glyph.set(null);
    this.#glyph.open.activeContourId.set(null);
  }

  public get $designLocation(): Signal<AxisLocation> {
    return this.#glyph.design.location;
  }

  /** Current designspace coordinate used for displayed glyph data. */
  public get designLocation(): AxisLocation {
    return this.#glyph.design.location.peek();
  }

  /**
   * Reactive ID of the authored source selected for editing.
   *
   * `null` means the edit target follows the exact source at
   * `designLocation`, if one exists.
   */
  public get $editSourceId(): Signal<SourceId | null> {
    return this.#glyph.edit.sourceId;
  }

  /** ID of the authored source selected for editing, or `null` for location fallback. */
  public get editSourceId(): SourceId | null {
    return this.#glyph.edit.sourceId.peek();
  }

  /** Authored font source currently selected for editing, or `null` when unavailable. */
  public get editSource(): Source | null {
    return this.#glyph.edit.source.peek();
  }

  /**
   * Returns the authored glyph source currently targeted by edit commands.
   *
   * @remarks
   * This is the source-backed edit target, not the interpolated preview
   * geometry shown at the current design location. Clipboard, command, and test
   * code should use this when reading or mutating authored point data.
   *
   * @returns null when no glyph source is open for editing.
   */
  public get activeGlyphSource(): GlyphSource | null {
    return this.#glyph.edit.glyphSource.peek();
  }

  /** Glyph instance resolved at the current design location. */
  public get glyphInstance(): GlyphInstance | null {
    return this.#glyph.preview.instance.peek();
  }

  public get glyphInstanceCell(): Signal<GlyphInstance | null> {
    return this.#glyph.preview.instance;
  }

  /**
   * Set the displayed designspace coordinate and synchronize edit-source focus.
   *
   * If the location exactly matches an authored source, that source becomes the
   * explicit edit target. Otherwise the edit target falls back to location
   * resolution and may be `null`.
   */
  public setDesignLocation(location: AxisLocation): void {
    batch(() => {
      this.#glyph.design.set(location);

      const source = this.font.sourceAt(location);
      if (source) {
        this.#glyph.edit.selectSource(source.id);
      } else {
        this.#glyph.edit.selectDefaultSource();
      }
    });
  }

  /**
   * Select every point in the active editable source.
   *
   * This intentionally uses the editable source rather than interpolated
   * design-location geometry: selection is an edit target, so it must refer to
   * authored source point IDs that commands can mutate.
   */
  public selectAll(): void {
    const instance = this.glyphInstance;
    if (!instance?.edit) return;

    this.selection.select(
      instance.geometry.allPoints.map((point) => ({
        kind: "point",
        id: point.id,
      })),
    );
    return;
  }

  /**
   * Select an authored source for editing and move the display location to it.
   *
   * Missing source IDs are ignored. This does not open a glyph; it retargets
   * the current open glyph's edit source when one is available.
   */
  public selectSource(sourceId: SourceId): void {
    const source = this.font.source(sourceId);
    if (!source) return;

    batch(() => {
      const location = axisLocationFromLocation(source.location);
      this.#glyph.design.set(location);
      this.#glyph.edit.selectSource(source.id);
    });
  }

  /**
   * Clear explicit edit-source selection.
   *
   * The editor will resolve the edit source from the current design location
   * until another source is selected.
   */
  public clearActiveSource(): void {
    this.#glyph.edit.selectDefaultSource();
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
    this.textRun.insert(glyphTextItem(handle.name, codepoint));
  }

  /** @knipclassignore Indirectly consumed through Renderer. */
  public editableGlyphVisible(): boolean {
    return this.#glyphDisplay.cell.peek().editableGlyphVisible;
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
    return this.#glyph.open.glyph;
  }

  public get commandHistory(): CommandHistory {
    return this.#commandHistory;
  }

  /** Subscribe to a lifecycle event. Returns an unsubscribe function. */
  public on: EventEmitter["on"] = (...args) => this.#events.on(...args);

  public get commands(): CommandHistory {
    return this.#commandHistory;
  }

  public get bridge(): ShiftBridge {
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
    this.#commandHistory.undo();
  }

  public redo() {
    this.#commandHistory.redo();
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
   * Sets the active editable glyph's horizontal advance through command history.
   *
   * @param width - New advance width in UPM units.
   */
  public setXAdvance(width: number): void {
    const instance = this.glyphInstance;
    if (!instance?.edit) return;

    if (instance.xAdvance === width) return;

    this.#commandHistory.execute(new SetXAdvanceCommand(instance.xAdvance, width));
  }

  /**
   * Sets the active editable glyph's left sidebearing by translating its outline.
   *
   * @param value - Desired left sidebearing in UPM units.
   */
  public setLeftSidebearing(value: number): void {
    const instance = this.glyphInstance;
    if (!instance?.edit) return;

    const bbox = instance.render.outline.bounds;
    if (!bbox) return;

    const delta = Math.round(value) - Math.round(bbox.min.x);
    if (delta === 0) return;

    const beforeXAdvance = instance.xAdvance;
    this.#commandHistory.execute(
      new SetLeftSidebearingCommand(beforeXAdvance, beforeXAdvance + delta, delta),
    );
  }

  /**
   * Sets the active editable glyph's right sidebearing by changing its advance.
   *
   * @param value - Desired right sidebearing in UPM units.
   */
  public setRightSidebearing(value: number): void {
    const instance = this.glyphInstance;
    if (!instance?.edit) return;

    const bbox = instance.render.outline.bounds;
    if (!bbox) return;

    const currentRsb = instance.xAdvance - bbox.max.x;
    const delta = Math.round(value) - Math.round(currentRsb);
    if (delta === 0) return;

    const beforeXAdvance = instance.xAdvance;
    this.#commandHistory.execute(
      new SetRightSidebearingCommand(beforeXAdvance, beforeXAdvance + delta),
    );
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

  /**
   * Creates a new loaded font document and resets editor placement to its
   * default design location.
   */
  public createFont(sourcePath: string, storePath: string): void {
    this.font.create(sourcePath, storePath);
    this.setDesignLocation(this.font.defaultLocation());
    this.#events.emit("fontLoaded", { font: this.font });
  }

  /**
   * Loads a font from disk and resets editor placement to its default design
   * location.
   */
  public loadFont(filePath: string, storePath: string): void {
    this.font.load(filePath, storePath);
    this.setDesignLocation(this.font.defaultLocation());
    this.#events.emit("fontLoaded", { font: this.font });
  }

  public closeFont(): void {
    this.font.close();
    this.setDesignLocation(emptyAxisLocation());
  }

  public async saveFont(filePath?: string): Promise<number> {
    return this.font.save(filePath);
  }

  public async exportFont(filePath: string): Promise<void> {
    await this.font.export(filePath);
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

  /** Deletes currently selected points from the active editable glyph. */
  public deleteSelectedPoints(): void {
    const edit = this.glyphInstance?.edit;
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

    const glyph = this.#glyph.open.glyph.peek();
    if (!glyph) return false;

    return this.#clipboard.write(content, { sourceGlyph: glyph.name });
  }

  public async cut(): Promise<boolean> {
    const content = this.#selectedClipboardContent();
    if (!content || content.contours.length === 0) return false;

    const glyph = this.#glyph.open.glyph.peek();
    if (!glyph) return false;

    const written = await this.#clipboard.write(content, {
      sourceGlyph: glyph.name,
    });
    if (!written) return false;

    const pointIds = this.#selectedClipboardPointIds();
    this.#commandHistory.execute(new CutCommand(pointIds));
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
    this.#commandHistory.execute(command);

    if (command.createdPointIds.length > 0) {
      this.selection.select(command.createdPointIds.map((id) => ({ kind: "point", id })));
    }
  }

  #selectionCenter(): Point2D | null {
    const bounds = this.selection.bounds;
    return bounds ? Bounds.center(bounds) : null;
  }

  #selectedClipboardContent(): ClipboardContent | null {
    const source = this.#glyph.edit.glyphSource.peek();
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

  public get activeContourIdCell(): Signal<ContourId | null> {
    return this.#glyph.open.activeContourId;
  }

  public getActiveContourId(): ContourId | null {
    const id = this.#glyph.open.activeContourId.peek();
    if (!id) return null;

    return id;
  }

  public setActiveContour(contourId: ContourId | null): void {
    this.#glyph.open.activeContourId.set(contourId);
  }

  public clearActiveContour(): void {
    this.#glyph.open.activeContourId.set(null);
  }

  public getActiveContour(): Contour | null {
    const activeContourId = this.getActiveContourId();
    if (!activeContourId) return null;

    return this.glyphInstance?.geometry.contour(activeContourId) ?? null;
  }

  public continueContour(contourId: ContourId, fromStart: boolean, pointId: PointId): void {
    this.#glyph.open.activeContourId.set(contourId);
    if (fromStart) {
      this.#commandHistory.execute(new ReverseContourCommand(contourId));
    }
    this.selection.select([{ kind: "point", id: pointId }]);
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

  public upgradeLineToCubic(segment: LineSegmentPoints): void {
    this.#commandHistory.execute(new UpgradeLineToCubicCommand(segment));
  }

  public boolean(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): void {
    this.#commandHistory.execute(new BooleanOperationCommand(contourIdA, contourIdB, operation));
  }

  public duplicateSelection(): PointId[] {
    const content = this.#selectedClipboardContent();
    if (!content || content.contours.length === 0) return [];

    const command = new PasteCommand(content, { offset: { x: 0, y: 0 } });
    this.#commandHistory.execute(command);
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
