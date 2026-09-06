import type { CursorType, ToolRegistryItem } from "@/types/editor";
import type { FontSessionMode } from "@shared/workspace/protocol";
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
  type GlyphId,
  type GlyphName,
  type GlyphRecord,
  type LayerId,
} from "@shift/types";
import { isSegmentId, type SegmentId } from "@shift/glyph-state";
import type { ExternalAxisLocation } from "@/types/variation";
import type { Coordinates, NodePoint, ScenePoint } from "@/types/coordinates";
import {
  axisValue,
  cloneExternalAxisLocation,
  emptyExternalAxisLocation,
} from "@/lib/variation/location";
import type { ActiveTool, ToolName, ToolRegistration } from "../tools/core";
import { ToolManager } from "../tools/core/ToolManager";
import { Bounds, Vec2, type Bounds as BoundsType, type Point2D, type Rect2D } from "@shift/geo";

import { Camera } from "./managers";
import {
  computed,
  effect,
  signal,
  track,
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
import { Hover } from "./Hover";
import { Renderer } from "./rendering/Renderer";
import { Scene } from "./Scene";
import type { Canvas2DSurface, MarkerCanvasSurface } from "./rendering/CanvasSurface";
import type { CameraTransform } from "./managers";
import type { DebugOverlays } from "@/types/uiState";
import type { TemporaryToolOptions } from "@/types/editor";
import { Editing } from "./Editing";
import { EditorHistory } from "./EditorHistory";
import { Selection } from "./Selection";
import type { Font } from "../model/Font";
import type { FontStore } from "../model/FontStore";
import type { Glyph, GlyphLayer } from "../model/Glyph";
import type { DeleteMode, GlyphGeometrySelection } from "@/types/glyph";
import type { Modifiers } from "../tools/core/GestureDetector";
import { Text } from "@/lib/text/Text";
import { TextRuns } from "@/lib/text/TextRuns";
import { TextRun } from "@/lib/text/TextRun";
import { glyphTextItem, Positioner } from "@/lib/text/layout";

import type { ToolManifest, ToolShortcutEntry } from "@/types/tools";
import type { ToolStateScope } from "@/types/editor";
import { EventEmitter } from "./lifecycle";

import { ShiftStore } from "@/lib/store/ShiftStore";
import { EditorGesture, EditorInput, EditorViewState } from "./EditorState";
import type { PointerTarget } from "@/types/target";
import type {
  PositionSelection,
  SelectableId,
  ShiftEditorRecord,
  ShiftId,
  ShiftObject,
} from "@/types";
import type { GlyphNode, NodeKind } from "@/types/node";
import { AnchorObject, ContourObject, NodeObject, PointObject, SegmentObject } from "@/lib/objects";
import type { NodeDefinition, NodeDefinitionConstructor } from "@/lib/nodes/NodeDefinition";
import { GlyphNodeDefinition } from "../nodes/GlyphNodeDefinition";
import { TextRunNodeDefinition } from "../nodes/TextRunNodeDefinition";

const DEFAULT_NODE_DEFINITIONS: NodeDefinitionConstructor[] = [
  GlyphNodeDefinition,
  TextRunNodeDefinition,
];

interface EditorOptions {
  font: Font;
  fontStore: FontStore;
  clipboard: SystemClipboard;
  sessionMode: FontSessionMode;
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
   * `Selection` and `Hover` are mutable runtime state. `Font` owns public
   * document operations while the private `FontStore` resolves already-loaded
   * Glyph objects for ID-based scene nodes.
   */
  readonly selection: Selection;
  readonly history: EditorHistory;
  readonly editing: Editing;
  readonly hover: Hover;
  readonly font: Font;
  /** Immutable preview interaction capability; authored glyph edits still require an authored layer. */
  readonly sessionMode: FontSessionMode;
  readonly scene: Scene;
  readonly text: Text;
  readonly #nodeDefinitions: Map<NodeKind, NodeDefinition> = new Map();
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #fontStore: FontStore;

  /**
   * Rendering and camera infrastructure.
   *
   * Drawer instances live on `GlyphNodeDefinition` (and on owning tools),
   * not here; `Editor` holds only the `Renderer` that orchestrates the
   * background/scene/overlay passes.
   */
  #renderer: Renderer;

  #toolManager: ToolManager;
  #toolRegistry: Signal<ReadonlyMap<ToolName, ToolRegistryItem>>;
  #tool: Signal<ActiveTool | null>;
  #dragging: Signal<boolean>;
  #isEditing: Signal<boolean>;
  #selectionBounds: Signal<Rect2D | null>;
  readonly #handlesCell = signal<ReadonlyMap<symbol, PointId | ContourId>>(new Map(), {
    name: "editor.handles",
  });

  /**
   * Runtime services with lifecycle or side effects.
   *
   * These mutate process/editor state: camera, bridge IO,
   * event dispatch, and registered tool state. They should stay separate from
   * immutable glyph geometry and from render-only state.
   */
  #camera: Camera;

  #externalLocation: WritableSignal<ExternalAxisLocation>;
  #activeSourceId: WritableSignal<SourceId | null>;

  #cursorEffect: Effect;
  #cameraMetricsEffect: Effect;

  #clipboard: Clipboard;

  #events: EventEmitter;

  #textRuns: TextRuns;

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
   * @param options - Session-scoped services and immutable presentation mode.
   */
  constructor(options: EditorOptions) {
    this.#camera = new Camera();

    this.font = options.font;
    this.sessionMode = options.sessionMode;
    this.#store = new ShiftStore();
    this.#fontStore = options.fontStore;
    this.scene = new Scene(this.#store);

    const initialExternalLocation = emptyExternalAxisLocation();

    this.#externalLocation = signal(initialExternalLocation, {
      name: "editor.externalLocation",
    });
    this.#activeSourceId = signal<SourceId | null>(
      this.font.sourceAt(initialExternalLocation)?.id ?? null,
      {
        name: "editor.source.active",
      },
    );
    this.text = new Text(this.#store, this);

    const nodeDefs = new Map<NodeKind, NodeDefinition>();
    for (const Def of options.nodeDefinitions ?? DEFAULT_NODE_DEFINITIONS) {
      const def = new Def(this);
      nodeDefs.set(def.kind, def);
    }

    this.#nodeDefinitions = nodeDefs;

    this.#view = new EditorViewState();
    this.input = new EditorInput();
    this.gesture = new EditorGesture();

    this.#toolState = {
      app: new Map<string, unknown>(),
      document: new Map<string, unknown>(),
    };

    this.selection = new Selection(this.#store);
    this.history = new EditorHistory(
      this.selection,
      this.sessionMode === "authored" ? this.font.editCoordinator : null,
    );
    this.editing = new Editing(this.#store);
    this.hover = new Hover();
    this.#selectionBounds = computed(
      () => {
        track(this.selection.stateCell);
        return this.selectionBounds();
      },
      {
        name: "editor.selection.bounds",
      },
    );

    // TODO: why not make editor extend EventEmitter?
    this.#events = new EventEmitter();
    this.#toolManager = new ToolManager(this);
    this.#toolRegistry = computed(
      () => {
        const registry = new Map<ToolName, ToolRegistryItem>();
        for (const [id, manifest] of this.#toolManager.manifestsCell.value) {
          if (manifest.menuSelectionCell) track(manifest.menuSelectionCell);

          const { icon, tooltip, shortcut, onSelect, menuItems, hidden, disabled } = manifest;
          const item: ToolRegistryItem = { icon, tooltip };
          if (shortcut) item.shortcut = shortcut;
          if (onSelect) item.onSelect = onSelect;
          if (menuItems) {
            item.menuItems = menuItems.map(({ id, icon, label, shortcut, selected, onSelect }) => ({
              id,
              icon,
              label,
              shortcut,
              selected,
              onSelect,
            }));
          }
          if (hidden) item.hidden = true;
          if (disabled) item.disabled = true;
          registry.set(id, item);
        }
        return registry;
      },
      { name: "editor.toolRegistry" },
    );
    this.#tool = computed<ActiveTool | null>(
      () => {
        const activeTool = this.#toolManager.activeToolCell.value;
        if (!activeTool) return null;

        return {
          id: activeTool.id,
          state: activeTool.stateCell.value,
        };
      },
      { name: "editor.tool" },
    );
    this.#dragging = computed(() => this.gesture.cell.value.phase === "dragging", {
      name: "editor.dragging",
    });
    this.#isEditing = computed(
      () => this.#toolManager.activeToolCell.value?.isEditingCell.value ?? false,
      { name: "editor.isEditing" },
    );

    this.#clipboard = new Clipboard(options.clipboard);

    this.#textRuns = new TextRuns(this, new Positioner());

    this.#renderer = new Renderer(this);

    this.#cameraMetricsEffect = effect(
      () => {
        track(this.font.metricsCell);
        track(this.font.metricDefinitionsCell);
        track(this.font.sourcesCell);
        track(this.font.sourceMetricsInterpolationCell);
        this.updateMetricsFromFont(this.#externalLocation.value);
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

  /**
   * Installs a tool contribution and returns the handle that owns it.
   *
   * @param manifest - Stable identity, metadata, and factory to install.
   * @returns The handle used to replace or permanently remove the contribution.
   */
  public registerTool(manifest: ToolManifest): ToolRegistration {
    return this.toolManager.register(manifest);
  }

  public get toolRegistry(): ReadonlyMap<ToolName, ToolRegistryItem> {
    return this.#toolRegistry.peek();
  }

  public get toolRegistryCell(): Signal<ReadonlyMap<ToolName, ToolRegistryItem>> {
    return this.#toolRegistry;
  }

  public getToolShortcuts(): ToolShortcutEntry[] {
    const shortcuts: ToolShortcutEntry[] = [];
    for (const [toolId, manifest] of this.#toolManager.manifests) {
      if (manifest.hidden || manifest.disabled) continue;

      if (manifest.shortcut != null) {
        const shortcut: ToolShortcutEntry = { toolId, shortcut: manifest.shortcut };
        if (manifest.onSelect) shortcut.onSelect = manifest.onSelect;
        shortcuts.push(shortcut);
      }

      for (const item of manifest.menuItems ?? []) {
        if (item.shortcut === manifest.shortcut) continue;

        shortcuts.push({ toolId, shortcut: item.shortcut, onSelect: item.onSelect });
      }
    }
    return shortcuts;
  }

  /** Returns the current active tool snapshot, or null before a tool is activated. */
  public get tool(): ActiveTool | null {
    return this.#tool.peek();
  }

  /** Exposes the live active tool identity and state as one reactive value. */
  public get toolCell(): Signal<ActiveTool | null> {
    return this.#tool;
  }

  /**
   * Returns the active tool narrowed to the requested identity.
   *
   * @param id - Tool identity whose current state the caller needs.
   * @returns The active tool snapshot when its identity matches; otherwise null.
   */
  public toolIf<Id extends ToolName>(id: Id): ActiveTool<Id> | null {
    const tool = this.#tool.peek();
    if (tool?.id !== id) return null;

    return tool as ActiveTool<Id>;
  }

  /** Returns whether a pointer drag gesture is currently in flight. */
  public get isDragging(): boolean {
    return this.#dragging.peek();
  }

  /** Exposes the live pointer-drag phase independently of tool state names. */
  public get draggingCell(): Signal<boolean> {
    return this.#dragging;
  }

  public get isEditing(): boolean {
    return this.#isEditing.peek();
  }

  public get isEditingCell(): Signal<boolean> {
    return this.#isEditing;
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

  public get externalLocationCell(): Signal<ExternalAxisLocation> {
    return this.#externalLocation;
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

  /** Current external user-space coordinate used for displayed font data. */
  public get externalLocation(): ExternalAxisLocation {
    return this.#externalLocation.peek();
  }

  /** Selects an interpolated external user-space location shared by editor views. */
  public setExternalLocation(location: ExternalAxisLocation): void {
    this.#externalLocation.set(cloneExternalAxisLocation(location));
    this.#activeSourceId.set(null);
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
      const authoredNode = layer ? this.#placedGlyphNodeForLayer(layer) : null;
      const contourId = this.font.contourIdForPoint(id);
      if (layer && authoredNode && contourId) {
        return new PointObject(id, contourId, layer.geometry, authoredNode, layer);
      }

      for (const node of this.scene.nodesOfKind("glyph")) {
        const geometry = this.glyphForId(node.glyphId)?.geometryAt(this.externalLocation);
        if (!geometry?.point(id)) continue;

        const contourId = geometry.contourIdOfPoint(id);
        if (!contourId) continue;

        return new PointObject(id, contourId, geometry, node);
      }
      return null;
    }

    if (isAnchorId(id)) {
      const layer = this.#layerForAnchor(id);
      const authoredNode = layer ? this.#placedGlyphNodeForLayer(layer) : null;
      if (layer && authoredNode) {
        return new AnchorObject(id, layer.geometry, authoredNode, layer);
      }

      for (const node of this.scene.nodesOfKind("glyph")) {
        const geometry = this.glyphForId(node.glyphId)?.geometryAt(this.externalLocation);
        if (!geometry?.anchor(id)) continue;

        return new AnchorObject(id, geometry, node);
      }
      return null;
    }

    if (isSegmentId(id)) {
      const layer = this.#layerForSegment(id);
      const authoredNode = layer ? this.#placedGlyphNodeForLayer(layer) : null;
      const pointIds = this.font.pointIdsForSegment(id);
      const contourId = this.font.contourIdForSegment(id);
      if (layer && authoredNode && pointIds && contourId) {
        return new SegmentObject(id, contourId, pointIds, layer.geometry, authoredNode, layer);
      }

      for (const node of this.scene.nodesOfKind("glyph")) {
        const geometry = this.glyphForId(node.glyphId)?.geometryAt(this.externalLocation);
        const segment = geometry?.segment(id);
        if (!geometry || !segment) continue;

        const contour = geometry.contours.find((candidate) =>
          candidate.segments().some((candidateSegment) => candidateSegment.id === id),
        );
        if (!contour) continue;

        return new SegmentObject(id, contour.id, segment.pointIds, geometry, node);
      }
      return null;
    }

    if (isContourId(id)) {
      const layer = this.#layerForContour(id);
      const authoredNode = layer ? this.#placedGlyphNodeForLayer(layer) : null;
      if (layer && authoredNode) {
        return new ContourObject(id, layer.geometry, authoredNode, layer);
      }

      for (const node of this.scene.nodesOfKind("glyph")) {
        const geometry = this.glyphForId(node.glyphId)?.geometryAt(this.externalLocation);
        if (!geometry?.contour(id)) continue;

        return new ContourObject(id, geometry, node);
      }
      return null;
    }

    return null;
  }

  /**
   * Resolves geometry ids to the single available authored layer that owns all of them.
   *
   * @param ids - Geometry ids to resolve. Empty input resolves to `null`.
   * @returns The sole owning authored layer, or `null` when any id is unknown
   * or the ids span multiple layers.
   */
  layerForGeometry(ids: GlyphGeometrySelection): GlyphLayer | null {
    let owner: LayerId | null = null;

    const fold = (layerId: LayerId | null): boolean => {
      if (!layerId || (owner !== null && owner !== layerId)) return false;
      owner = layerId;
      return true;
    };

    for (const pointId of ids.points ?? []) {
      if (!fold(this.font.layerIdForPoint(pointId))) return null;
    }
    for (const anchorId of ids.anchors ?? []) {
      if (!fold(this.font.layerIdForAnchor(anchorId))) return null;
    }
    for (const contourId of ids.contours ?? []) {
      if (!fold(this.font.layerIdForContour(contourId))) return null;
    }
    for (const segmentId of ids.segments ?? []) {
      if (!fold(this.font.layerIdForSegment(segmentId))) return null;
    }

    return owner === null ? null : this.#layerForId(owner);
  }

  /**
   * Normalizes editor object IDs into point and anchor targets on one editable layer.
   *
   * Segment and contour IDs expand to their constituent points. The selection is
   * rejected when any ID is unresolved, unsupported, spans layers, or belongs to
   * a layer outside the active authored source.
   */
  public positionSelection(ids: readonly SelectableId[]): PositionSelection | null {
    const objects = this.objects(ids);
    if (objects.length === 0 || objects.length !== ids.length) return null;

    const points = new Set<PointId>();
    const anchors = new Set<AnchorId>();

    for (const object of objects) {
      switch (object.kind) {
        case "point":
          points.add(object.pointId);
          break;
        case "anchor":
          anchors.add(object.anchorId);
          break;
        case "segment":
          for (const pointId of object.pointIds) points.add(pointId);
          break;
        case "contour": {
          const contour = object.geometry.contour(object.contourId);
          if (!contour) return null;

          for (const point of contour.points) points.add(point.id);
          break;
        }
        case "node":
          return null;
      }
    }

    const layer = this.layerForGeometry({ points, anchors });
    const sourceId = this.activeSourceId;
    if (!layer || sourceId === null || layer.sourceId !== sourceId) return null;

    return {
      layer,
      targets: {
        points: [...points],
        anchors: [...anchors],
      },
    };
  }

  #layerForPoint(pointId: PointId): GlyphLayer | null {
    const layerId = this.font.layerIdForPoint(pointId);
    if (!layerId) return null;

    const layer = this.#layerForId(layerId);
    return layer?.point(pointId) ? layer : null;
  }

  #layerForAnchor(anchorId: AnchorId): GlyphLayer | null {
    const layerId = this.font.layerIdForAnchor(anchorId);
    if (!layerId) return null;

    const layer = this.#layerForId(layerId);
    return layer?.anchor(anchorId) ? layer : null;
  }

  #layerForSegment(segmentId: SegmentId): GlyphLayer | null {
    const layerId = this.font.layerIdForSegment(segmentId);
    if (!layerId) return null;

    const layer = this.#layerForId(layerId);
    return layer?.segment(segmentId) ? layer : null;
  }

  #layerForContour(contourId: ContourId): GlyphLayer | null {
    const layerId = this.font.layerIdForContour(contourId);
    if (!layerId) return null;

    const layer = this.#layerForId(layerId);
    return layer?.contour(contourId) ? layer : null;
  }

  #layerForId(layerId: LayerId): GlyphLayer | null {
    for (const node of this.scene.nodesOfKind("glyph")) {
      const layer = this.glyphForId(node.glyphId)?.layerForId(layerId);
      if (layer) return layer;
    }

    return null;
  }

  #placedGlyphNodeForLayer(layer: GlyphLayer): GlyphNode | null {
    for (const node of this.scene.nodesOfKind("glyph")) {
      if (node.sourceId !== layer.sourceId) continue;

      const nodeLayer = this.#fontStore.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
      if (nodeLayer?.id === layer.id) return node;
    }

    return null;
  }

  /**
   * Returns a complete Glyph already available to this editor runtime.
   *
   * @remarks
   * This is a synchronous NodeDefinition and plugin lookup. It never starts
   * workspace I/O. Use `font.recordForId()` to test current-font existence and
   * `font.loadGlyph()` to acquire a Glyph before publishing a dependent node.
   *
   * @param glyphId - Current-font Glyph identity to inspect.
   * @returns The canonical complete Glyph, or `null` when it is not currently available.
   */
  glyphForId(glyphId: GlyphId): Glyph | null {
    return this.#fontStore.glyphForId(glyphId);
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

  /**
   * Hides a point's or contour's editing handles without changing geometry or selection.
   *
   * @param id - A point marker and its attached control lines, or all handles and segment
   * highlights belonging to a contour.
   * @returns An idempotent function that releases this request. Overlapping requests remain
   * independent; callers own cleanup, for example through a tool drag's cancellation scope.
   */
  public hideHandles(id: PointId | ContourId): () => void {
    const key = Symbol("hidden handles");
    const handles = new Map(this.#handlesCell.peek());
    handles.set(key, id);
    this.#handlesCell.set(handles);

    return () => {
      const handles = new Map(this.#handlesCell.peek());
      if (!handles.delete(key)) return;

      this.#handlesCell.set(handles);
    };
  }

  /**
   * Reports whether a point's or contour's editing handles may be rendered.
   *
   * @param id - Point or contour whose visibility is being queried.
   * @param contourId - Known owning contour for a point, avoiding per-marker object resolution.
   * @returns False while a matching point or parent-contour request is active; tracks rendering.
   */
  public handlesVisible(id: PointId | ContourId, contourId?: ContourId): boolean {
    track(this.#handlesCell);
    const handles = this.#handlesCell.peek();
    if (handles.size === 0) return true;

    if (isPointId(id) && contourId === undefined) {
      const object = this.object(id);
      if (object?.kind === "point") contourId = object.contourId;
    }

    for (const target of handles.values()) {
      if (target === id || target === contourId) return false;
    }

    return true;
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

    const layer = this.#fontStore.glyphForId(node.glyphId)?.layerForSource(sourceId);
    if (!layer) return;

    this.selection.select(layer.allPoints.map((point) => point.id));
  }

  /** Selects an existing exact source layer without changing the external location. */
  public selectSource(sourceId: SourceId): void {
    if (!this.font.source(sourceId)) return;

    this.#activeSourceId.set(sourceId);
  }

  /**
   * Selects a source for editing, materializing the current glyph layer when absent.
   *
   * @remarks
   * This is the authored-only lazy glyph-layer materialization boundary. The
   * current interpolated geometry is captured only for the opened glyph;
   * unopened glyphs remain sparse.
   */
  public selectSourceForEditing(sourceId: SourceId): void {
    const source = this.font.source(sourceId);
    if (!source) return;

    this.font.editCoordinator.transaction("Select source", () => {
      this.#ensureCurrentGlyphLayer(
        source.id,
        (glyph) => glyph.geometryForSource(source.id).values,
      );
    });
    this.selectSource(source.id);
  }

  /**
   * Creates a source from the editor and selects it for the current glyph.
   *
   * @remarks
   * This composes pure font source creation with editor source selection. The
   * global source, interpolated source metrics, and current glyph layer are
   * submitted as one workspace operation. The external location changes
   * immediately, while exact source activation waits for the workspace echo so
   * reactive consumers never observe an unknown source identity.
   *
   * @param name - Display name for the new source.
   * @param location - External user-space location for the new source.
   * @returns The source id submitted to the workspace.
   */
  public createSource(name: string, externalLocation: ExternalAxisLocation): SourceId {
    const targetLocation = cloneExternalAxisLocation(externalLocation);
    const sourceId = this.font.editCoordinator.transaction("Create source", () => {
      const createdSourceId = this.font.createSource(name, targetLocation);
      this.#ensureCurrentGlyphLayer(
        createdSourceId,
        (glyph) => glyph.geometryAt(targetLocation).values,
      );
      this.setExternalLocation(targetLocation);
      return createdSourceId;
    });

    void this.#activateCreatedSource(sourceId, targetLocation);
    return sourceId;
  }

  async #activateCreatedSource(
    sourceId: SourceId,
    externalLocation: ExternalAxisLocation,
  ): Promise<void> {
    await this.font.editCoordinator.settled();
    if (!this.font.source(sourceId) || this.#activeSourceId.peek() !== null) return;

    const axes = this.font.getAxes();
    const currentLocation = this.#externalLocation.peek();
    const locationChanged = axes.some(
      (axis) => axisValue(currentLocation, axis) !== axisValue(externalLocation, axis),
    );
    if (locationChanged) return;

    this.#activeSourceId.set(sourceId);
  }

  #ensureCurrentGlyphLayer(sourceId: SourceId, valuesFor: (glyph: Glyph) => Float64Array): void {
    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return;

    const [node] = glyphNodes;
    if (!node) return;

    const glyph = this.#fontStore.glyphForId(node.glyphId);
    if (!glyph) return;

    if (!glyph.layerForSource(sourceId)) {
      const defaultLayer = glyph.layerForSource(this.font.defaultSource.id);
      if (!defaultLayer) return;

      this.font.materializeGlyphLayer(node.glyphId, sourceId, defaultLayer.id, valuesFor(glyph));
    }

    this.scene.updateNode({ id: node.id, sourceId });
  }

  /** Return the shared external location to the font default. */
  public setSourceToDefault(): void {
    this.setExternalLocation(this.font.defaultLocation());
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

  /** Notifies presentation code that a preview interaction attempted to mutate font data. */
  public notifyPreviewMutationAttempt(): void {
    if (this.sessionMode !== "preview") return;

    this.#events.emit("previewMutationAttempted");
  }

  public get camera(): Camera {
    return this.#camera;
  }

  public async undo(): Promise<void> {
    await this.history.undo();
  }

  public async redo(): Promise<void> {
    await this.history.redo();
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

    return this.#fontStore.glyphForId(node.glyphId)?.layerForSource(sourceId)?.xAdvance ?? 0;
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

    this.#fontStore.glyphForId(node.glyphId)?.layerForSource(sourceId)?.setXAdvance(width);
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

    this.#fontStore.glyphForId(node.glyphId)?.layerForSource(sourceId)?.setLeftSidebearing(value);
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

    this.#fontStore.glyphForId(node.glyphId)?.layerForSource(sourceId)?.setRightSidebearing(value);
  }

  public updateMetricsFromFont(location: ExternalAxisLocation = this.externalLocation): void {
    const metrics = this.font.metricsAtLocation(location);
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
    const objects = this.objects(ids);
    if (objects.length === 0 || objects.length !== ids.length) return null;

    const pointIds = new Set<PointId>();
    for (const object of objects) {
      switch (object.kind) {
        case "point":
          pointIds.add(object.pointId);
          break;
        case "segment":
          for (const pointId of object.pointIds) pointIds.add(pointId);
          break;
        case "contour": {
          const contour = object.geometry.contour(object.contourId);
          if (!contour) return null;

          for (const point of contour.points) pointIds.add(point.id);
          break;
        }
        case "anchor":
        case "node":
          return null;
      }
    }

    const layer = this.layerForGeometry({ points: pointIds });
    if (!layer) return null;

    const content = ClipboardSelection.fromPointIds([...pointIds]).contentFrom(layer);
    if (!content || content.contours.length === 0) return null;

    return content;
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

    const layer = this.#fontStore.glyphForId(node.glyphId)?.layerForSource(sourceId);
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
    await this.font.editCoordinator.settled();

    const content = this.contentFrom(this.selection.ids);
    if (!content) return false;

    return this.#clipboard.write(content);
  }

  public async cut(): Promise<boolean> {
    await this.font.editCoordinator.settled();

    const selection = this.positionSelection(this.selection.ids);
    const pointIds = selection?.targets.points ?? [];
    if (!selection || pointIds.length === 0 || (selection.targets.anchors?.length ?? 0) > 0) {
      return false;
    }

    const content = ClipboardSelection.fromPointIds(pointIds).contentFrom(selection.layer);
    if (!content || content.contours.length === 0) return false;

    const written = await this.#clipboard.write(content);
    if (!written) return false;

    const capture = this.history.beginCapture();
    try {
      this.transaction("Cut", () => {
        selection.layer.removePoints(pointIds);
      });
      this.selection.clear();
      capture.finish();
    } catch (error) {
      capture.discard();
      throw error;
    }

    await this.font.editCoordinator.settled();
    return true;
  }

  public async deleteSelection(mode: DeleteMode = "fit"): Promise<boolean> {
    const selection = this.positionSelection(this.selection.ids);
    const pointIds = selection?.targets.points ?? [];
    if (!selection || pointIds.length === 0 || (selection.targets.anchors?.length ?? 0) > 0) {
      return false;
    }

    const capture = this.history.beginCapture();
    try {
      if (!selection.layer.deletePoints(pointIds, mode)) {
        capture.discard();
        return false;
      }

      this.selection.clear();
      this.hover.clear();
      capture.finish();
    } catch (error) {
      capture.discard();
      throw error;
    }

    await this.font.editCoordinator.settled();
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
        const capture = this.history.beginCapture();
        try {
          const inserted = this.insertContent(result.content, {
            offset: this.#clipboard.nextPasteOffset(),
          });
          if (!inserted) {
            capture.discard();
            return false;
          }

          this.selection.select(inserted);
          this.setActiveTool("select");
          capture.finish();
        } catch (error) {
          capture.discard();
          throw error;
        }

        await this.font.editCoordinator.settled();
        return true;
      }

      case "empty":
      case "unsupported":
        return false;
    }
  }

  /**
   * Applies a Boolean operation and selects every resulting contour once committed.
   *
   * @param contourIdA - First complete closed contour participating in the operation.
   * @param contourIdB - Second complete closed contour participating in the operation.
   * @param operation - Set operation applied to the two contours.
   */
  public async boolean(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): Promise<void> {
    const sourceId = this.activeSourceId;
    if (!sourceId) return;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return;

    const [node] = glyphNodes;
    if (!node) return;

    const layer = this.#fontStore.glyphForId(node.glyphId)?.layerForSource(sourceId);
    if (!layer || !layer.contour(contourIdA) || !layer.contour(contourIdB)) return;

    const capture = this.history.beginCapture();
    try {
      const previousContourIds = new Set(layer.contours.map((contour) => contour.id));
      layer.applyBooleanOp(contourIdA, contourIdB, operation);
      await this.font.editCoordinator.settled();

      const resultContourIds = layer.contours
        .filter((contour) => !previousContourIds.has(contour.id))
        .map((contour) => contour.id);
      this.selection.select(resultContourIds);
      capture.finish();
    } catch (error) {
      capture.discard();
      throw error;
    }
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
    this.#toolManager.dispose();
    this.history.dispose();
    this.#handlesCell.set(new Map());
    this.#events.dispose();
  }

  #toolStateKey(toolId: string, key: string): string {
    return `${toolId}:${key}`;
  }

  #getToolScopeMap(scope: ToolStateScope): Map<string, unknown> {
    return this.#toolState[scope];
  }
}
