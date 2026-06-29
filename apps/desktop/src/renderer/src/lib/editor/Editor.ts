import type { CursorType, ToolRegistryItem } from "@/types/editor";
import type { PointId, ContourId, Source, SourceId, GlyphName, GlyphRecord } from "@shift/types";
import type { AxisLocation } from "@/types/variation";
import type { Coordinates, NodePoint, ScenePoint } from "@/types/coordinates";
import {
  axisLocationFromLocation,
  cloneAxisLocation,
  emptyAxisLocation,
} from "@/lib/variation/location";
import type { ToolName, ActiveToolState } from "../tools/core";
import { ToolManager } from "../tools/core/ToolManager";
import { Segment } from "@shift/glyph-state";
import { Vec2, type Point2D, type Rect2D } from "@shift/geo";

import { Camera } from "./managers";
import {
  CommandRunner,
  NudgePointsCommand,
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
import type { GlyphLayer } from "../model/Glyph";
import type { Modifiers } from "../tools/core/GestureDetector";
import { TextRuns } from "@/lib/text/TextRuns";
import { TextRun } from "@/lib/text/TextRun";
import { glyphTextItem, Positioner } from "@/lib/text/layout";

import type { ToolManifest, ToolShortcutEntry } from "@/types/tools";
import type { ToolStateScope } from "@/types/editor";
import { EventEmitter } from "./lifecycle";

import type { LineSegmentPoints } from "@shift/glyph-state";
import { GlyphLayerEditDraft, type GlyphLayerEditSubject } from "./GlyphLayerEditDraft";
import { Scene } from "./Scene";
import { EditorGesture, EditorInput, EditorViewState } from "./EditorState";
import type { PointerTarget } from "@/types/target";

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

  #designLocation: WritableSignal<AxisLocation>;
  #activeSourceId: WritableSignal<SourceId | null>;

  #cursorEffect: Effect;
  #cameraMetricsEffect: Effect;

  #clipboard: Clipboard;

  #events: EventEmitter;

  #textRuns: TextRuns;

  #glyphFinderOpen: WritableSignal<boolean>;

  #zone: FocusZone = "canvas";

  readonly gesture: EditorGesture;
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
    const initialDesignLocation = emptyAxisLocation();
    this.#designLocation = signal(initialDesignLocation, {
      name: "editor.designLocation",
    });
    this.#activeSourceId = signal<SourceId | null>(
      this.#sourceIdAtLocation(initialDesignLocation),
      {
        name: "editor.source.active",
      },
    );

    this.#view = new EditorViewState();
    this.input = new EditorInput();
    this.gesture = new EditorGesture();

    this.#commands = new CommandRunner(
      signal<GlyphLayer | null>(null, { name: "editor.commands.unboundLayer" }),
    );

    this.#toolState = {
      app: new Map<string, unknown>(),
      document: new Map<string, unknown>(),
    };

    this.#glyphFinderOpen = signal(false, { name: "editor.glyphFinder.open" });

    this.selection = new Selection();
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

    this.#renderer = new Renderer(this);

    this.#cameraMetricsEffect = effect(
      () => {
        this.font.loadedCell.value;
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
    void subject;
    throw new Error("Glyph layer edit drafts require an explicit glyph layer");
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

  public get designLocationCell(): Signal<AxisLocation> {
    return this.#designLocation;
  }

  public get activeSourceIdCell(): Signal<SourceId | null> {
    return this.#activeSourceId;
  }

  public get activeSourceId(): SourceId | null {
    return this.#activeSourceId.peek();
  }

  public get activeSource(): Source | null {
    const sourceId = this.#activeSourceId.peek();
    return sourceId ? this.font.source(sourceId) : null;
  }

  /** Current designspace coordinate used for displayed glyph data. */
  public get designLocation(): AxisLocation {
    return this.#designLocation.peek();
  }

  /**
   * Set the displayed designspace coordinate shared by editor views.
   */
  public setDesignLocation(location: AxisLocation): void {
    const next = cloneAxisLocation(location);
    this.#designLocation.set(next);
    this.#activeSourceId.set(this.#sourceIdAtLocation(next));
  }

  /**
   * Select every point in the active authored glyph layer.
   *
   * This intentionally uses the authored glyph layer rather than interpolated
   * design-location geometry: selection mutates an authored layer, so it must
   * refer to point IDs that commands can mutate.
   */
  public selectAll(): void {
    return;
  }

  /**
   * Select an authored glyph layer for editing and move the display location to it.
   *
   * Missing source IDs are ignored. This does not open a glyph; it moves the
   * shared design location to the source.
   */
  public selectSource(sourceId: SourceId): void {
    const source = this.font.source(sourceId);
    if (!source) return;

    this.#activeSourceId.set(source.id);
    this.setDesignLocation(axisLocationFromLocation(source.location));
  }

  /**
   * Return the shared design location to the font default.
   */
  public setSourceToDefault(): void {
    this.setDesignLocation(this.font.defaultLocation());
  }

  #sourceIdAtLocation(location: AxisLocation): SourceId | null {
    return this.font.sourceAt(location)?.id ?? null;
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
    if (record) {
      this.font.loadGlyph(record.id).catch((error) => {
        console.error("failed to load inserted text glyph", error);
      });
    }
    this.textRun.insert(glyphTextItem(handle.name, codepoint));
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

  getPointInNodeSpace(point: ScenePoint, nodePosition: Point2D): NodePoint {
    return Vec2.sub(point, nodePosition);
  }

  getPointerTarget(point: ScenePoint): PointerTarget {
    const nodes = this.scene.nodes();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (!node) continue;

      switch (node.kind) {
        case "glyph": {
          const nodePoint = this.getPointInNodeSpace(point, node.position);
          const instance = this.font.instance(node.glyphId, this.designLocationCell);
          if (!instance) break;

          const hit = instance.geometry.hitAt(nodePoint, this.hitRadius);
          if (!hit) break;

          if (hit.kind === "segment") {
            const segment = instance.geometry.segment(hit.id);
            if (!segment) break;

            return {
              ...hit,
              nodeId: node.id,
              glyphId: node.glyphId,
              point: nodePoint,
              pointIds: segment.pointIds,
            };
          }

          return {
            ...hit,
            nodeId: node.id,
            glyphId: node.glyphId,
            point: nodePoint,
          };
        }
      }
    }

    return { kind: "canvas", point };
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
    return 0;
  }

  /**
   * Sets the active glyph layer's horizontal advance through command history.
   *
   * @param width - New advance width in UPM units.
   */
  public setXAdvance(width: number): void {
    void width;
  }

  /**
   * Sets the active glyph layer's left sidebearing by translating its outline.
   *
   * @param value - Desired left sidebearing in UPM units.
   */
  public setLeftSidebearing(value: number): void {
    void value;
  }

  /**
   * Sets the active glyph layer's right sidebearing by changing its advance.
   *
   * @param value - Desired right sidebearing in UPM units.
   */
  public setRightSidebearing(value: number): void {
    void value;
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
    return { screen, scene };
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

  public async copy(): Promise<boolean> {
    const content = this.#selectedClipboardContent();
    if (!content || content.contours.length === 0) return false;

    return this.#clipboard.write(content);
  }

  public async cut(): Promise<boolean> {
    const content = this.#selectedClipboardContent();
    if (!content || content.contours.length === 0) return false;

    const written = await this.#clipboard.write(content);
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
      this.selection.select(command.createdPointIds.map((pointId) => ({ kind: "point", pointId })));
    }
  }

  #selectionCenter(): Point2D | null {
    return null;
  }

  #selectedClipboardContent(): ClipboardContent | null {
    return null;
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
