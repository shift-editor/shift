import type { CursorType, ToolRegistryItem } from "@/types/editor";
import {
  isAnchorId,
  isContourId,
  isNodeId,
  isPointId,
  type AnchorId,
  type PointId,
  type ContourId,
  type Source,
  type SourceId,
  type GlyphName,
  type GlyphRecord,
} from "@shift/types";
import { isSegmentId, type SegmentId } from "@shift/glyph-state";
import type { AxisLocation } from "@/types/variation";
import type { Coordinates, NodePoint, ScenePoint } from "@/types/coordinates";
import {
  axisLocationFromLocation,
  cloneAxisLocation,
  emptyAxisLocation,
} from "@/lib/variation/location";
import type { ToolName, ActiveToolState } from "../tools/core";
import { ToolManager } from "../tools/core/ToolManager";
import { Bounds, Vec2, type Bounds as BoundsType, type Point2D, type Rect2D } from "@shift/geo";

import { Camera } from "./managers";
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
  ClipboardSelection,
  type PasteOptions,
  type ShiftContent,
  type SystemClipboard,
} from "../clipboard";
import { cursorToCSS } from "../styles/cursor";
import { EdgePanManager } from "./managers";
import { Hover } from "./Hover";
import { Renderer } from "./rendering/Renderer";
import { Scene } from "./Scene";
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

import { ShiftStore } from "@/lib/store/ShiftStore";
import { EditorGesture, EditorInput, EditorViewState } from "./EditorState";
import type { PointerTarget } from "@/types/target";
import type { SelectableId, ShiftEditorRecord, ShiftId, ShiftObject } from "@/types";
import type { GlyphNode, NodeKind } from "@/types/node";
import { AnchorObject, ContourObject, NodeObject, PointObject, SegmentObject } from "@/lib/objects";
import type { NodeDefinition, NodeDefinitionConstructor } from "@/lib/nodes/NodeDefinition";
import { GlyphNodeDefinition } from "../nodes/GlyphNodeDefinition";

const DEFAULT_NODE_DEFINITIONS: NodeDefinitionConstructor[] = [GlyphNodeDefinition];

interface EditorOptions {
  font: Font;
  clipboard: SystemClipboard;
  nodeDefinitions?: readonly NodeDefinitionConstructor[];
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
 * Font state arrives through the injected `Font` model; the editor does not
 * expose a separate glyph loading API.
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
  readonly #nodeDefinitions: Map<NodeKind, NodeDefinition> = new Map();
  readonly #store: ShiftStore<ShiftEditorRecord>;

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
  #activeTool: Signal<ToolName | null>;
  #activeToolState: WritableSignal<ActiveToolState>;
  #isEditing: Signal<boolean>;
  #selectionBounds: Signal<Rect2D | null>;

  /**
   * Runtime services with lifecycle or side effects.
   *
   * These mutate process/editor state: camera, bridge IO,
   * event dispatch, and registered tool state. They should stay separate from
   * immutable glyph geometry and from render-only state.
   */
  #camera: Camera;

  #designLocation: WritableSignal<AxisLocation>;
  #activeSourceId: WritableSignal<SourceId | null>;

  #cursorEffect: Effect;
  #cameraMetricsEffect: Effect;

  #clipboard: Clipboard;

  #events: EventEmitter;

  #textRuns: TextRuns;

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
    this.#store = new ShiftStore();
    this.scene = new Scene(this.#store);

    const nodeDefs = new Map<NodeKind, NodeDefinition>();
    for (const Def of options.nodeDefinitions ?? DEFAULT_NODE_DEFINITIONS) {
      const def = new Def(this);
      nodeDefs.set(def.kind, def);
    }

    this.#nodeDefinitions = nodeDefs;

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

    this.#toolState = {
      app: new Map<string, unknown>(),
      document: new Map<string, unknown>(),
    };

    this.selection = new Selection(this.#store);
    this.hover = new Hover();
    this.#selectionBounds = computed(() => this.selectionBounds(), {
      name: "editor.selection.bounds",
    });

    this.#edgePan = new EdgePanManager(this);

    this.#toolMetadata = new Map();
    this.#activeToolState = signal<ActiveToolState>(
      { type: "idle" },
      {
        name: "editor.tool.state",
      },
    );

    // TODO: why not make editor extend EventEmitter?
    this.#events = new EventEmitter();
    this.#toolManager = new ToolManager(this);
    this.#activeTool = computed(() => this.#toolManager.activeToolCell.value?.id ?? null, {
      name: "editor.tool.active",
    });
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

  public get activeTool(): ToolName | null {
    return this.#activeTool.peek();
  }

  public get activeToolCell(): Signal<ToolName | null> {
    return this.#activeTool;
  }

  // oxlint-disable-next-line shift/no-get-signal-value-method -- retained for upcoming tool refactor
  public getActiveTool(): ToolName | null {
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
    if (this.toolManager.primaryToolId === toolName && this.toolManager.activeToolId === toolName) {
      return;
    }

    this.toolManager.activate(toolName);
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
   * Resolves an editor-addressable id to the current live object.
   *
   * @param id - Object identity to resolve in the current editor state.
   * @returns The resolved object, or `null` when no object exists for the id.
   */
  public object(id: ShiftId): ShiftObject | null {
    if (isNodeId(id)) {
      const node = this.scene.node(id);
      if (!node) return null;

      return new NodeObject(node, this.nodeDefinition(node.kind));
    }

    if (isPointId(id)) {
      const layer = this.#layerForPoint(id);
      if (!layer) return null;

      const node = this.#placedGlyphNodeForLayer(layer);
      if (!node) return null;

      return new PointObject(id, layer, node);
    }

    if (isAnchorId(id)) {
      const layer = this.#layerForAnchor(id);
      if (!layer) return null;

      const node = this.#placedGlyphNodeForLayer(layer);
      if (!node) return null;

      return new AnchorObject(id, layer, node);
    }

    if (isSegmentId(id)) {
      const layer = this.#layerForSegment(id);
      if (!layer) return null;

      const node = this.#placedGlyphNodeForLayer(layer);
      if (!node) return null;

      const pointIds = this.font.pointIdsForSegment(id);
      if (!pointIds) return null;

      return new SegmentObject(id, pointIds, layer, node);
    }

    if (isContourId(id)) {
      const layer = this.#layerForContour(id);
      if (!layer) return null;

      const node = this.#placedGlyphNodeForLayer(layer);
      if (!node) return null;

      return new ContourObject(id, layer, node);
    }

    return null;
  }

  #layerForPoint(pointId: PointId): GlyphLayer | null {
    const layerId = this.font.layerIdForPoint(pointId);
    if (!layerId) return null;

    const layer = this.font.layerById(layerId);
    if (!layer?.point(pointId)) return null;

    return layer;
  }

  #layerForAnchor(anchorId: AnchorId): GlyphLayer | null {
    const layerId = this.font.layerIdForAnchor(anchorId);
    if (!layerId) return null;

    const layer = this.font.layerById(layerId);
    if (!layer?.anchor(anchorId)) return null;

    return layer;
  }

  #layerForSegment(segmentId: SegmentId): GlyphLayer | null {
    const layerId = this.font.layerIdForSegment(segmentId);
    if (!layerId) return null;

    const layer = this.font.layerById(layerId);
    if (!layer?.segment(segmentId)) return null;

    return layer;
  }

  #layerForContour(contourId: ContourId): GlyphLayer | null {
    const layerId = this.font.layerIdForContour(contourId);
    if (!layerId) return null;

    const layer = this.font.layerById(layerId);
    if (!layer?.contour(contourId)) return null;

    return layer;
  }

  #placedGlyphNodeForLayer(layer: GlyphLayer): GlyphNode | null {
    for (const node of this.scene.nodesOfKind("glyph")) {
      if (node.sourceId !== layer.sourceId) continue;

      const nodeLayer = this.font.layer(node.glyphId, node.sourceId);
      if (nodeLayer?.id === layer.id) return node;
    }

    return null;
  }

  nodeDefinition(kind: NodeKind): NodeDefinition | null {
    return this.#nodeDefinitions.get(kind) ?? null;
  }

  /**
   * Resolves editor-addressable ids to objects.
   *
   * @param ids - Object identities to resolve in selection or command order.
   * @returns Resolved objects in input order. Unresolved ids are omitted.
   */
  public objects(ids: readonly ShiftId[]): readonly ShiftObject[] {
    const objects: ShiftObject[] = [];

    for (const id of ids) {
      const object = this.object(id);
      if (object) objects.push(object);
    }

    return objects;
  }

  /**
   * Returns the current selection bounds in scene coordinates.
   *
   * @remarks
   * Selection stores IDs only. This method resolves those IDs against the
   * current scene and font, asks each object for its live bounds, and returns a
   * fresh axis-aligned rectangle enclosing the resolved objects.
   *
   * @returns null when nothing is selected or no selected object has bounds.
   */
  public selectionBounds(): Rect2D | null {
    let bounds: BoundsType | null = null;

    for (const id of this.selection.ids) {
      const object = this.object(id);
      if (!object) continue;

      const objectBounds = object.bounds();
      if (!objectBounds) continue;

      const next = Bounds.fromXYWH(
        objectBounds.x,
        objectBounds.y,
        objectBounds.width,
        objectBounds.height,
      );
      bounds = bounds ? Bounds.union(bounds, next) : next;
    }

    return bounds ? Bounds.toRect(bounds) : null;
  }

  /** Reactive scene-space bounds for the current selection. */
  public get selectionBoundsCell(): Signal<Rect2D | null> {
    return this.#selectionBounds;
  }

  /**
   * Select every point in the active authored glyph layer.
   *
   * This intentionally uses the authored glyph layer rather than interpolated
   * design-location geometry: selection mutates an authored layer, so it must
   * refer to point IDs that layer operations can mutate.
   */
  public selectAll(): void {
    const sourceId = this.activeSourceId;
    if (!sourceId) return;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return;

    const [node] = glyphNodes;
    if (!node) return;

    const layer = this.font.layer(node.glyphId, sourceId);
    if (!layer) return;

    this.selection.select(layer.allPoints.map((point) => point.id));
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

      const definition = this.nodeDefinition(node.kind);
      if (!definition) continue;

      const nodePoint = this.getPointInNodeSpace(point, node.position);
      const target = definition.hit(node, nodePoint);
      if (target) return target;
    }

    return { kind: "canvas", point };
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

  public undo() {
    // One undo authority: the workspace ledger (state-pair replay).
    void this.font.editCoordinator.undo();
  }

  public redo() {
    void this.font.editCoordinator.redo();
  }

  /**
   * Groups synchronous workspace edits into one undoable operation.
   *
   * @param label - Human-readable operation name for diagnostics and future ledger labels.
   * @param body - Synchronous edit body that calls model mutation APIs.
   * @returns The value returned by `body`.
   */
  public transaction<TResult>(label: string, body: () => TResult): TResult {
    return this.font.editCoordinator.transaction(label, body);
  }

  public setCameraRect(rect: Rect2D) {
    this.#camera.setRect(rect);
  }

  public setCameraUpm(upm: number) {
    this.#camera.upm = upm;
  }

  public get xAdvance(): number {
    const sourceId = this.activeSourceId;
    if (!sourceId) return 0;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return 0;

    const [node] = glyphNodes;
    if (!node) return 0;

    return this.font.layer(node.glyphId, sourceId)?.xAdvance ?? 0;
  }

  /**
   * Sets the current glyph layer's horizontal advance.
   *
   * @param width - New advance width in UPM units.
   */
  public setXAdvance(width: number): void {
    const sourceId = this.activeSourceId;
    if (!sourceId) return;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return;

    const [node] = glyphNodes;
    if (!node) return;

    this.font.layer(node.glyphId, sourceId)?.setXAdvance(width);
  }

  /**
   * Sets the current glyph layer's left sidebearing.
   *
   * @param value - Desired left sidebearing in UPM units.
   */
  public setLeftSidebearing(value: number): void {
    const sourceId = this.activeSourceId;
    if (!sourceId) return;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return;

    const [node] = glyphNodes;
    if (!node) return;

    this.font.layer(node.glyphId, sourceId)?.setLeftSidebearing(value);
  }

  /**
   * Sets the current glyph layer's right sidebearing.
   *
   * @param value - Desired right sidebearing in UPM units.
   */
  public setRightSidebearing(value: number): void {
    const sourceId = this.activeSourceId;
    if (!sourceId) return;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return;

    const [node] = glyphNodes;
    if (!node) return;

    this.font.layer(node.glyphId, sourceId)?.setRightSidebearing(value);
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

  /**
   * Builds portable editor content from live object ids.
   *
   * @remarks
   * The first content producer supports glyph point, segment, and contour
   * objects that resolve to one authored layer. Segment and contour objects are
   * expanded to concrete points before content is detached from live state.
   *
   * @param ids - Object identities to snapshot.
   * @returns Detached content, or `null` when ids are empty, unsupported,
   * unresolved, span multiple layers, or produce no portable geometry.
   */
  public contentFrom(ids: readonly ShiftId[]): ShiftContent | null {
    const selection = this.#pointSelectionFromIds(ids);
    if (!selection) return null;

    const content = ClipboardSelection.fromPointIds(selection.pointIds).contentFrom(
      selection.layer,
    );
    if (!content || content.contours.length === 0) return null;

    return content;
  }

  #pointSelectionFromIds(
    ids: readonly ShiftId[],
  ): { layer: GlyphLayer; pointIds: readonly PointId[] } | null {
    const objects = this.objects(ids);
    if (objects.length === 0 || objects.length !== ids.length) return null;

    let layer: GlyphLayer | null = null;
    const pointIds = new Set<PointId>();

    const useLayer = (next: GlyphLayer): boolean => {
      if (layer && layer.id !== next.id) return false;

      layer = next;
      return true;
    };

    for (const object of objects) {
      switch (object.kind) {
        case "point":
          if (!useLayer(object.layer)) return null;

          pointIds.add(object.pointId);
          break;

        case "segment":
          if (!useLayer(object.layer)) return null;

          for (const pointId of object.pointIds) pointIds.add(pointId);
          break;

        case "contour": {
          if (!useLayer(object.layer)) return null;

          const contour = object.layer.contour(object.contourId);
          if (!contour) return null;

          for (const point of contour.points) pointIds.add(point.id);
          break;
        }

        case "anchor":
        case "node":
          return null;
      }
    }

    if (!layer) return null;

    return { layer, pointIds: [...pointIds] };
  }

  /**
   * Inserts portable content into the current editor destination.
   *
   * @remarks
   * The first insertion destination is conservative: exactly one glyph node in
   * the scene plus an active source resolves to one authored glyph layer.
   *
   * @param content - Detached content produced by {@link contentFrom} or clipboard import.
   * @param options - Placement options applied while minting destination objects.
   * @returns Selection IDs for inserted objects, or `null` when no content can
   * be inserted into the current destination.
   */
  public insertContent(
    content: ShiftContent,
    options: PasteOptions = { offset: { x: 0, y: 0 } },
  ): readonly SelectableId[] | null {
    const sourceId = this.activeSourceId;
    if (!sourceId) return null;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return null;

    const [node] = glyphNodes;
    if (!node) return null;

    const layer = this.font.layer(node.glyphId, sourceId);
    if (!layer) return null;

    const inserted: SelectableId[] = [];

    this.transaction("Insert content", () => {
      for (const contour of content.contours) {
        if (contour.points.length === 0) continue;

        const contourId = layer.addContour();

        for (const point of contour.points) {
          const pointId = layer.addPoint(contourId, {
            ...point,
            x: point.x + options.offset.x,
            y: point.y + options.offset.y,
          });

          inserted.push(pointId);
        }

        if (contour.closed) {
          layer.closeContour(contourId);
        }
      }
    });

    return inserted.length === 0 ? null : inserted;
  }

  /**
   * Writes selected editor content to the system clipboard.
   *
   * @returns `true` when portable content was written, otherwise `false`.
   */
  public async copy(): Promise<boolean> {
    const content = this.contentFrom(this.selection.ids);
    if (!content) return false;

    return this.#clipboard.write(content);
  }

  public async cut(): Promise<boolean> {
    const selection = this.#pointSelectionFromIds(this.selection.ids);
    if (!selection || selection.pointIds.length === 0) return false;

    const content = ClipboardSelection.fromPointIds(selection.pointIds).contentFrom(
      selection.layer,
    );
    if (!content || content.contours.length === 0) return false;

    const written = await this.#clipboard.write(content);
    if (!written) return false;

    this.transaction("Cut", () => {
      selection.layer.removePoints(selection.pointIds);
    });
    this.selection.clear();

    return true;
  }

  public deleteSelection(): boolean {
    const selection = this.#pointSelectionFromIds(this.selection.ids);
    if (!selection || selection.pointIds.length === 0) return false;

    this.transaction("Delete selection", () => {
      selection.layer.removePoints(selection.pointIds);
    });
    this.selection.clear();

    return true;
  }

  /**
   * Reads the system clipboard and inserts supported content.
   *
   * @returns `true` when content was inserted, otherwise `false`.
   */
  public async paste(): Promise<boolean> {
    const result = await this.#clipboard.read();

    switch (result.kind) {
      case "content": {
        const inserted = this.insertContent(result.content, {
          offset: this.#clipboard.nextPasteOffset(),
        });
        if (!inserted) return false;

        this.selection.select(inserted);
        return true;
      }

      case "empty":
      case "unsupported":
        return false;
    }
  }

  public boolean(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): void {
    const sourceId = this.activeSourceId;
    if (!sourceId) return;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return;

    const [node] = glyphNodes;
    if (!node) return;

    const layer = this.font.layer(node.glyphId, sourceId);
    if (!layer) return;

    layer.applyBooleanOp(contourIdA, contourIdB, operation);
  }

  public duplicateSelection(): PointId[] {
    const content = this.contentFrom(this.selection.ids);
    if (!content || content.contours.length === 0) return [];

    const inserted = this.insertContent(content, { offset: { x: 0, y: 0 } });
    if (!inserted) return [];

    return inserted.filter(isPointId);
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
