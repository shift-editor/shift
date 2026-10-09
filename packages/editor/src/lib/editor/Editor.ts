import type { CursorType, ToolRegistryItem } from "../../types/editor";
import {
  isAnchorId,
  isContourId,
  isComponentId,
  isNodeId,
  isTextItemId,
  isPointId,
  type AnchorId,
  type ComponentId,
  type PointId,
  type ContourId,
  type Source,
  type SourceId,
  type GlyphId,
  type GlyphName,
  type GlyphRecord,
  type Unicode,
  type FontSessionMode,
  type LayerId,
  type LayerMatch,
  type NodeId,
  type SegmentId,
  type SelectableId,
  type ShiftId,
} from "@shift/types";
import { isSegmentId } from "@shift/glyph-state";
import type { ExternalAxisLocation } from "../../types/variation";
import type { SourceSelectionMode } from "../../types/sourceSelection";
import type {
  Coordinates,
  LocalBounds,
  LocalPoint,
  LocalVector,
  SceneBounds,
  ScenePoint,
  SceneVector,
  ScreenPoint,
  ScreenVector,
  SpaceTransform,
} from "../../types/coordinates";
import {
  applyLinear,
  applyTransform,
  invertTransform,
  localBounds,
  sceneBounds,
  spaceTransform,
  transformBounds,
} from "./spaces";
import {
  axisValue,
  cloneExternalAxisLocation,
  emptyExternalAxisLocation,
} from "../variation/location";
import type { ActiveTool, ToolName, ToolRegistration } from "../tools/core";
import { ToolManager } from "../tools/core/ToolManager";
import { Bounds, Mat, type Bounds as BoundsType, type Point2D, type Rect2D } from "@shift/geo";

import { applyListSelection } from "./listSelection";
import { Camera } from "./managers";
import {
  batch,
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
import { Snapping } from "./Snapping";
import { Renderer } from "./rendering/Renderer";
import { Scene } from "./Scene";
import type { Canvas2DSurface, MarkerCanvasSurface } from "./rendering/CanvasSurface";
import type { EditorRenderTheme } from "./rendering/Theme";
import type { CameraTransform } from "./managers";
import type { DebugOverlays } from "../../types/uiState";
import type { TemporaryToolOptions } from "../../types/editor";
import { Editing } from "./Editing";
import { Selection } from "./Selection";
import { EditorHistory } from "./history/EditorHistory";
import type { Font } from "../model/Font";
import type { FontStore } from "../model/FontStore";
import type { Glyph, GlyphLayer } from "../model/Glyph";
import type { DeleteMode, GlyphGeometrySelection } from "../../types/glyph";
import type { Modifiers } from "../tools/core/GestureDetector";
import { Text } from "../text/Text";
import { TextEditing } from "../text/TextEditing";

import type { ToolManifest, ToolShortcutEntry } from "../../types/tools";
import type { ToolStateScope } from "../../types/editor";
import { EventEmitter } from "./lifecycle";

import { ShiftStore } from "../store/ShiftStore";
import { EditorGesture, EditorInput, EditorViewState } from "./EditorState";
import type { PointerTarget } from "../../types/target";
import type { ComponentTransformSelection } from "../../types/componentTransform";
import type { ComponentTargets } from "../../types/componentTargets";
import type { PositionSelection } from "../../types/positionEdit";
import type { ShiftObject } from "../../types/object";
import type { ShiftEditorRecord, ShiftRecordId } from "../../types/records";
import type { GlyphNode, NodeKind, ShiftNode } from "../../types/node";
import {
  AnchorObject,
  ComponentObject,
  ContourObject,
  NodeObject,
  PointObject,
  TextItemObject,
  SegmentObject,
} from "../objects";
import type { NodeDefinition } from "../nodes/NodeDefinition";
import { GlyphNodeDefinition } from "../nodes/GlyphNodeDefinition";
import { TextRunNodeDefinition } from "../nodes/TextRunNodeDefinition";
import type { NodeDefinitionByKind, NodeDefinitionConstructors } from "../../types/nodeDefinition";
import { MultiSourceEditing } from "./MultiSourceEditing";

interface EditorOptions {
  font: Font;
  fontStore: FontStore;
  clipboard: SystemClipboard;
  sessionMode: FontSessionMode;
  nodeDefinitions?: Partial<NodeDefinitionConstructors>;
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
 *
 * @beta Embedders may use this type; its members can change between SDK minor versions.
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
  readonly editing: Editing;
  readonly history: EditorHistory;
  readonly hover: Hover;
  /** Builds the snap targets tools use while moving or placing glyph points. */
  readonly snapping: Snapping;
  readonly font: Font;
  /** Immutable persistence and editing capability; glyph edits still require an authored layer. */
  readonly sessionMode: FontSessionMode;
  readonly scene: Scene;
  readonly text: Text;
  readonly textEditing: TextEditing;
  readonly #nodeDefinitions: NodeDefinitionByKind;
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
  #toolId: Signal<ToolName | null>;
  readonly #toolCellsById = new Map<ToolName, Signal<ActiveTool | null>>();
  #dragging: Signal<boolean>;
  #isEditing: Signal<boolean>;
  #selectionBounds: Signal<LocalBounds | null>;
  #selectionSceneBounds: Signal<SceneBounds | null>;
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
  #activeSourceIdCell: WritableSignal<SourceId | null>;
  #editingSourceIdsCell: WritableSignal<ReadonlySet<SourceId>>;
  #multiSourceEditing: MultiSourceEditing;

  #cursorEffect: Effect;

  #clipboard: Clipboard;

  #events: EventEmitter;

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
    this.scene = new Scene(
      this.#store,
      (node) => this.nodeDefinition(node.kind).references?.(node) ?? [],
    );

    const initialExternalLocation = emptyExternalAxisLocation();

    const initialSourceId = this.font.sourceAt(initialExternalLocation)?.id ?? null;
    this.#externalLocation = signal(initialExternalLocation, {
      name: "editor.externalLocation",
    });
    this.#activeSourceIdCell = signal<SourceId | null>(initialSourceId, {
      name: "editor.source.active",
    });
    this.#editingSourceIdsCell = signal<ReadonlySet<SourceId>>(
      initialSourceId ? new Set([initialSourceId]) : new Set(),
      // Location changes rewrite this set on every scrub step; only a different
      // set of sources should re-render the source lists that read it.
      { name: "editor.sources.editing", equals: sameSourceIds },
    );
    this.#multiSourceEditing = new MultiSourceEditing(
      this.font,
      this.scene,
      (glyphId) => this.#fontStore.glyphForId(glyphId),
      this.#activeSourceIdCell,
      this.#editingSourceIdsCell,
    );
    this.text = new Text(this.#store, this);
    this.textEditing = new TextEditing(this.#store, this);

    const GlyphDefinition = options.nodeDefinitions?.glyph ?? GlyphNodeDefinition;
    const TextRunDefinition = options.nodeDefinitions?.textRun ?? TextRunNodeDefinition;
    this.#nodeDefinitions = {
      glyph: new GlyphDefinition(this),
      textRun: new TextRunDefinition(this),
    };

    this.#view = new EditorViewState();
    this.input = new EditorInput();
    this.gesture = new EditorGesture();

    this.#toolState = {
      app: new Map<string, unknown>(),
      document: new Map<string, unknown>(),
    };

    this.selection = new Selection(this.#store);
    this.editing = new Editing(this.#store);
    this.history = new EditorHistory(
      this,
      this.#store,
      this.sessionMode === "workspace" ? this.font.editCoordinator : null,
    );
    this.history.onCaptureFinishing((changed) => this.#runContentHooks(changed));
    this.hover = new Hover();
    this.snapping = new Snapping(this);
    this.#selectionBounds = computed(
      () => {
        track(this.selection.stateCell);
        return this.selectionBounds();
      },
      {
        name: "editor.selection.bounds",
      },
    );
    this.#selectionSceneBounds = computed(
      () => {
        track(this.selection.stateCell);
        track(this.scene.cell);
        return this.selectionSceneBounds();
      },
      {
        name: "editor.selection.sceneBounds",
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
    this.#toolId = computed(() => this.#toolManager.activeToolCell.value?.id ?? null, {
      name: "editor.toolId",
    });
    this.#dragging = computed(() => this.gesture.cell.value.phase === "dragging", {
      name: "editor.dragging",
    });
    this.#isEditing = computed(
      () => this.#toolManager.activeToolCell.value?.isEditingCell.value ?? false,
      { name: "editor.isEditing" },
    );

    this.#clipboard = new Clipboard(options.clipboard);

    this.#renderer = new Renderer(this);

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
   * Exposes the active tool's identity without its state.
   *
   * @remarks
   * Notifies only when the user switches tools. Readers that branch on which
   * tool is active subscribe here instead of {@link toolCell}, whose state
   * changes on every pointer move during a marquee or drag.
   */
  public get toolIdCell(): Signal<ToolName | null> {
    return this.#toolId;
  }

  /**
   * Exposes one tool's live state while that tool is active.
   *
   * @remarks
   * Holds null while another tool is active, so readers that follow one tool
   * ignore every other tool's state changes. The cell is created on first
   * request and reused for the editor's lifetime.
   *
   * @param id - Tool identity whose state the reader follows.
   * @returns A cell holding the active tool snapshot when its identity matches; otherwise null.
   */
  public toolCellIf<Id extends ToolName>(id: Id): Signal<ActiveTool<Id> | null> {
    let cell = this.#toolCellsById.get(id);
    if (!cell) {
      cell = computed(
        () => {
          if (this.#toolId.value !== id) return null;

          return this.#tool.value;
        },
        { name: `editor.tool.${id}` },
      );
      this.#toolCellsById.set(id, cell);
    }

    return cell as Signal<ActiveTool<Id> | null>;
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

  public setRenderTheme(theme: EditorRenderTheme): void {
    this.#renderer.setRenderTheme(theme);
  }

  public attachRenderSurfaces(
    background: Canvas2DSurface,
    scene: Canvas2DSurface,
    overlay: Canvas2DSurface,
    markers: MarkerCanvasSurface,
  ): void {
    this.#renderer.attachRenderSurfaces(background, scene, overlay, markers);
  }

  public detachRenderSurfaces(): void {
    this.#renderer.detachRenderSurfaces();
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
   * Creates one empty, encoded glyph per Unicode scalar as one undoable step.
   *
   * @param unicodes - Scalar values to create glyphs for; each glyph is named
   * from bundled glyph metadata.
   * @returns The records for the glyphs that were created, in input order.
   * @see {@link Font.createGlyphForUnicode}
   */
  public createGlyphsForUnicodes(unicodes: readonly Unicode[]): GlyphRecord[] {
    return this.transaction("Generate Glyphs", () =>
      unicodes.map((unicode) => this.font.createGlyphForUnicode(unicode)),
    );
  }

  /**
   * Creates an empty glyph and references it from every selected editing source.
   *
   * @remarks
   * Glyph creation and component insertion share one workspace transaction and
   * undo entry. Once committed, the active-source component becomes the current
   * selection.
   *
   * @param name - Canonical missing glyph name to create in the current font.
   * @returns The selected active-source component, or `null` when the current
   * glyph cannot be edited across the complete selected source set.
   * @throws {Error} when the workspace rejects glyph creation or the component reference.
   */
  public async createGlyphAndAddComponent(name: GlyphName): Promise<ComponentId | null> {
    const activeSourceId = this.activeSourceId;
    if (this.sessionMode !== "workspace" || !activeSourceId) return null;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    const [node] = glyphNodes;
    if (!node || glyphNodes.length !== 1) return null;

    const glyph = this.#fontStore.glyphForId(node.glyphId);
    if (!glyph) return null;

    const editingSourceIds = this.#editingSourceIdsCell.peek();
    const layers = this.font.sources
      .filter(({ id }) => editingSourceIds.has(id))
      .map(({ id }) => glyph.layerForSource(id));
    if (layers.length !== editingSourceIds.size || layers.some((layer) => layer === null)) {
      return null;
    }

    const componentIds = this.transaction("Create Component Glyph", () => {
      const record = this.createGlyph(name);

      return layers.map((layer) => {
        if (!layer) throw new Error("validated component layer is unavailable");
        return [layer.sourceId, layer.addComponent(record.id)] as const;
      });
    });
    const activeComponentId = componentIds.find(([sourceId]) => sourceId === activeSourceId)?.[1];
    if (!activeComponentId) return null;

    await this.font.editCoordinator.settled();
    this.selection.select([activeComponentId]);
    this.setActiveTool("select");
    return activeComponentId;
  }

  /**
   * Adds one component occurrence to every selected editing source.
   *
   * @remarks
   * The selected-source insertions commit as one undoable workspace operation.
   * Once committed, the active source occurrence becomes the current selection.
   *
   * @param baseGlyphId - Existing glyph to reference from the active glyph.
   * @returns The selected active-source component, or `null` when the current
   * glyph cannot be edited across the complete selected source set.
   * @throws {Error} when the workspace rejects the component reference.
   */
  public async addComponent(baseGlyphId: GlyphId): Promise<ComponentId | null> {
    const activeSourceId = this.activeSourceId;
    if (this.sessionMode !== "workspace" || !activeSourceId || !this.font.hasGlyph(baseGlyphId)) {
      return null;
    }

    // Load the base first so the component draws its outline as soon as it is added.
    await this.font.loadGlyph(baseGlyphId);

    const glyphNodes = this.scene.nodesOfKind("glyph");
    const [node] = glyphNodes;
    if (!node || glyphNodes.length !== 1 || node.glyphId === baseGlyphId) return null;

    const glyph = this.#fontStore.glyphForId(node.glyphId);
    if (!glyph) return null;

    const editingSourceIds = this.#editingSourceIdsCell.peek();
    const layers = this.font.sources
      .filter(({ id }) => editingSourceIds.has(id))
      .map(({ id }) => glyph.layerForSource(id));
    if (layers.length !== editingSourceIds.size || layers.some((layer) => layer === null)) {
      return null;
    }

    const componentIds = this.transaction("Add Component", () =>
      layers.map((layer) => {
        if (!layer) throw new Error("validated component layer is unavailable");
        return [layer.sourceId, layer.addComponent(baseGlyphId)] as const;
      }),
    );
    const activeComponentId = componentIds.find(([sourceId]) => sourceId === activeSourceId)?.[1];
    if (!activeComponentId) return null;

    await this.font.editCoordinator.settled();
    this.selection.select([activeComponentId]);
    this.setActiveTool("select");
    return activeComponentId;
  }

  public get externalLocationCell(): Signal<ExternalAxisLocation> {
    return this.#externalLocation;
  }

  public get activeSourceIdCell(): Signal<SourceId | null> {
    return this.#activeSourceIdCell;
  }

  public get activeSourceId(): SourceId | null {
    return this.#activeSourceIdCell.peek();
  }

  public get activeSource(): Source | null {
    const sourceId = this.#activeSourceIdCell.peek();
    return sourceId ? this.font.source(sourceId) : null;
  }

  public get editingSourceIdsCell(): Signal<ReadonlySet<SourceId>> {
    return this.#editingSourceIdsCell;
  }

  public get editingSourceIds(): ReadonlySet<SourceId> {
    return this.#editingSourceIdsCell.peek();
  }

  /**
   * Returns the live topology matches for selected non-reference layers.
   *
   * @remarks
   * The map is keyed by target layer ID and may contain incomplete matches for
   * diagnostics. Coordinate-only edits preserve the current map identity;
   * source, glyph, or structure changes clear it before asynchronous refresh.
   *
   * @returns Read-only reactive match state for the current editing source set.
   */
  public get editingLayerMatchesCell(): Signal<ReadonlyMap<LayerId, LayerMatch>> {
    return this.#multiSourceEditing.matchesCell;
  }

  /** Current external user-space coordinate used for displayed font data. */
  public get externalLocation(): ExternalAxisLocation {
    return this.#externalLocation.peek();
  }

  /**
   * Selects an external user-space location and activates any exact source there.
   *
   * @param location - User-control coordinates to publish across editor views.
   */
  public setExternalLocation(location: ExternalAxisLocation): void {
    const next = cloneExternalAxisLocation(location);

    const sourceId = this.font.sourceAt(next)?.id ?? null;

    batch(() => {
      this.#externalLocation.set(next);
      this.#activeSourceIdCell.set(sourceId);
      this.#editingSourceIdsCell.set(sourceId ? new Set([sourceId]) : new Set());
    });
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

    if (isComponentId(id)) {
      for (const node of this.scene.nodesOfKind("glyph")) {
        const glyph = this.glyphForId(node.glyphId);
        const renderModel = glyph?.renderModelAt(
          this.externalLocationCell,
          this.activeSourceIdCell,
        );
        const component = renderModel?.componentAt([id]);
        if (!glyph || !component) continue;

        const layer =
          node.sourceId === this.activeSourceId ? glyph.layerForSource(node.sourceId) : null;
        return new ComponentObject(component, node, layer);
      }
      return null;
    }

    if (isTextItemId(id)) {
      const location = this.text.itemLocation(id);
      const node = location ? this.scene.nodesReferencing(location.run.id)[0] : null;
      if (!location || node?.kind !== "textRun") return null;

      const { item } = location;
      const glyphId =
        item.kind === "glyph" ? (this.font.entryForName(item.glyphName)?.id ?? null) : null;
      return new TextItemObject(node, id, glyphId);
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

  #componentTargets(ids: readonly SelectableId[]): ComponentTargets | null {
    const objects = this.objects(ids);
    if (objects.length === 0 || objects.length !== ids.length) return null;

    const components: ComponentObject[] = [];
    for (const object of objects) {
      if (object.kind !== "component") return null;

      components.push(object);
    }

    const layer = components[0]?.layer;
    const nodeId = components[0]?.node.id;
    const sourceId = this.activeSourceId;
    if (!layer || !nodeId || !sourceId || layer.sourceId !== sourceId) return null;
    if (components.some((component) => component.layer !== layer || component.node.id !== nodeId)) {
      return null;
    }

    return this.#multiSourceEditing.matchComponentTargets({
      layer,
      componentIds: components.map((component) => component.componentId),
    });
  }

  /**
   * Resolves direct components into reference and matched-layer transform targets.
   *
   * @remarks
   * Every selected source must have a complete precomputed component match.
   * Bounds are captured in each source's glyph-local coordinates so scale and
   * rotation can use corresponding pivots without workspace reads during drag.
   *
   * @param ids - Selected direct component identities.
   * @returns The complete component selection, or `null` when any source cannot participate.
   */
  public componentTransformSelection(
    ids: readonly SelectableId[],
  ): ComponentTransformSelection | null {
    const targets = this.#componentTargets(ids);
    if (!targets) return null;

    const components = this.objects(ids).filter(
      (object): object is ComponentObject => object.kind === "component",
    );
    const bounds = Bounds.unionAll(components.map((component) => component.component.bounds));
    if (!bounds) return null;

    return this.#multiSourceEditing.resolveComponents({
      layer: targets.layer,
      componentIds: targets.componentIds,
      bounds: Bounds.toRect(bounds),
    });
  }

  /**
   * Resolves selected objects into reference and matched-layer position targets.
   *
   * @remarks
   * Segment and contour IDs expand to their constituent points. Multi-source
   * results require complete precomputed matches for every selected source; this
   * method performs no matching or workspace I/O.
   *
   * @param ids - Selected object identities to normalize as one interaction.
   * @returns Resolved layer targets, or `null` for unsupported, mixed, inactive,
   * pending, or incompletely matched selections.
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
        case "component":
        case "node":
          return null;
      }
    }

    const layer = this.layerForGeometry({ points, anchors });
    const sourceId = this.activeSourceId;
    if (!layer || sourceId === null || layer.sourceId !== sourceId) return null;

    return this.#multiSourceEditing.resolve({
      layer,
      targets: {
        points: [...points],
        anchors: [...anchors],
      },
    });
  }

  #layerForPoint(pointId: PointId): GlyphLayer | null {
    return this.#authoredLayer(
      this.font.layerIdForPoint(pointId),
      (layer) => !!layer.point(pointId),
    );
  }

  #layerForAnchor(anchorId: AnchorId): GlyphLayer | null {
    return this.#authoredLayer(
      this.font.layerIdForAnchor(anchorId),
      (layer) => !!layer.anchor(anchorId),
    );
  }

  #layerForSegment(segmentId: SegmentId): GlyphLayer | null {
    return this.#authoredLayer(
      this.font.layerIdForSegment(segmentId),
      (layer) => !!layer.segment(segmentId),
    );
  }

  #layerForContour(contourId: ContourId): GlyphLayer | null {
    return this.#authoredLayer(
      this.font.layerIdForContour(contourId),
      (layer) => !!layer.contour(contourId),
    );
  }

  /** Returns a loaded layer by id when it still holds the object the font indexed it for. */
  #authoredLayer(
    layerId: LayerId | null,
    holds: (layer: GlyphLayer) => boolean,
  ): GlyphLayer | null {
    const layer = layerId ? this.#layerForId(layerId) : null;
    return layer && holds(layer) ? layer : null;
  }

  #layerForId(layerId: LayerId): GlyphLayer | null {
    const glyphId = this.font.glyphIdForLayer(layerId);
    return glyphId ? (this.glyphForId(glyphId)?.layerForId(layerId) ?? null) : null;
  }

  /** Returns the glyph node showing a layer: one placing the layer's glyph at the layer's source. */
  #placedGlyphNodeForLayer(layer: GlyphLayer): GlyphNode | null {
    const glyphId = this.font.glyphIdForLayer(layer.id);
    if (!glyphId) return null;

    for (const node of this.scene.nodesReferencing(glyphId)) {
      if (node.kind === "glyph" && node.sourceId === layer.sourceId) return node;
    }
    return null;
  }

  /**
   * Returns a loaded glyph's layer at a source.
   *
   * @returns null when the glyph is not loaded or has no layer at that source.
   */
  layerForGlyph(glyphId: GlyphId, sourceId: SourceId): GlyphLayer | null {
    return this.glyphForId(glyphId)?.layerForSource(sourceId) ?? null;
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

  nodeDefinition(kind: "glyph"): GlyphNodeDefinition;
  nodeDefinition(kind: "textRun"): TextRunNodeDefinition;
  nodeDefinition(kind: NodeKind): NodeDefinition;
  nodeDefinition(kind: NodeKind): NodeDefinition {
    return this.#nodeDefinitions[kind];
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
   * Returns the box enclosing the given objects, in their node's own units.
   *
   * @remarks
   * The space editing works in: a glyph selection is measured in font units,
   * as the transform panel and edit pivots expect. For the camera and
   * on-canvas chrome use {@link selectionSceneBounds}.
   *
   * @param ids - Identities to bound, defaulting to the current selection; does not change selection.
   * @returns null when no supplied object has bounds, or when the objects belong to different nodes.
   */
  public selectionBounds(ids: readonly SelectableId[] = this.selection.ids): LocalBounds | null {
    let nodeId: NodeId | null = null;
    let bounds: BoundsType | null = null;

    for (const id of ids) {
      const object = this.object(id);
      if (!object) continue;

      const objectBounds = object.bounds();
      if (!objectBounds) continue;

      if (nodeId && object.node.id !== nodeId) return null;
      nodeId = object.node.id;
      bounds = bounds ? Bounds.union(bounds, objectBounds) : objectBounds;
    }

    return bounds ? localBounds(bounds) : null;
  }

  /**
   * Returns the scene node every given object belongs to.
   *
   * @param ids - Identities to resolve, defaulting to the current selection.
   * @returns null when nothing resolves or the objects belong to different nodes.
   */
  public selectionNode(ids: readonly SelectableId[] = this.selection.ids): ShiftNode | null {
    let node: ShiftNode | null = null;
    for (const id of ids) {
      const object = this.object(id);
      if (!object) continue;
      if (node && object.node.id !== node.id) return null;
      node = object.node;
    }
    return node;
  }

  /**
   * Returns the scene-space box enclosing the given objects, which may span several nodes.
   *
   * @remarks
   * For the camera and on-canvas selection chrome. Editing operations that work
   * in a glyph's units use {@link selectionBounds}.
   *
   * @param ids - Identities to bound, defaulting to the current selection; does not change selection.
   * @returns null when no supplied object has bounds.
   */
  public selectionSceneBounds(
    ids: readonly SelectableId[] = this.selection.ids,
  ): SceneBounds | null {
    let bounds: BoundsType | null = null;

    for (const id of ids) {
      const object = this.object(id);
      if (!object) continue;

      const objectBounds = object.bounds();
      if (!objectBounds) continue;

      const next = this.toSceneBounds(object.node, objectBounds);
      bounds = bounds ? Bounds.union(bounds, next) : next;
    }

    return bounds ? sceneBounds(bounds) : null;
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

  /** Reactive bounds of the current selection in its node's units; see {@link selectionBounds}. */
  public get selectionBoundsCell(): Signal<LocalBounds | null> {
    return this.#selectionBounds;
  }

  /** Reactive scene-space bounds of the current selection; see {@link selectionSceneBounds}. */
  public get selectionSceneBoundsCell(): Signal<SceneBounds | null> {
    return this.#selectionSceneBounds;
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

    const layer = this.layerForGlyph(node.glyphId, sourceId);
    if (!layer) return;

    this.history.capture("Select all", () => {
      this.selection.select(layer.allPoints.map((point) => point.id));
    });
  }

  /**
   * Selects an exact source and makes it the sole editing source.
   *
   * @param sourceId - Existing source to activate and represent in user controls.
   */
  public selectSource(sourceId: SourceId): void {
    const location = this.font.externalLocationForSource(sourceId);
    if (!location) return;

    batch(() => {
      this.#externalLocation.set(location);
      this.#activeSourceIdCell.set(sourceId);
      this.#editingSourceIdsCell.set(new Set([sourceId]));
    });
  }

  /**
   * Updates the editing-source selection around the active reference source.
   *
   * A single selection activates and materializes the requested source. Range
   * and toggle selections preserve the active source and only change the
   * session editing scope; the active source cannot be toggled out.
   *
   * @param sourceId - Source row receiving the selection interaction.
   * @param mode - Standard list-selection behavior to apply.
   */
  public selectSourceForEditing(sourceId: SourceId, mode: SourceSelectionMode = "single"): void {
    const source = this.font.source(sourceId);
    if (!source) return;

    switch (mode) {
      case "single": {
        this.font.editCoordinator.transaction("Select source", () => {
          this.#ensureCurrentGlyphLayer(
            source.id,
            (glyph) => glyph.geometryForSource(source.id).values,
          );
        });
        this.selectSource(source.id);
        return;
      }
      case "range":
      case "toggle": {
        const activeSourceId = this.#activeSourceIdCell.peek();
        if (!activeSourceId) {
          this.selectSourceForEditing(sourceId);
          return;
        }

        const sourceIds = this.font.sources.map(({ id }) => id);
        const editingSourceIds = [...this.#editingSourceIdsCell.peek()];
        const nextIds = applyListSelection(
          sourceIds,
          editingSourceIds,
          activeSourceId,
          sourceId,
          mode,
        );
        const nextEditingSourceIds = new Set(nextIds);
        nextEditingSourceIds.add(activeSourceId);
        this.#editingSourceIdsCell.set(nextEditingSourceIds);
        return;
      }
    }
  }

  /**
   * Toggles between editing every source and editing only the active reference source.
   *
   * @returns `true` when the editing selection changed; otherwise `false`.
   */
  public toggleAllSourcesForEditing(): boolean {
    const activeSourceId = this.#activeSourceIdCell.peek();
    if (this.sessionMode !== "workspace" || !activeSourceId) return false;

    const sourceIds = this.font.sources.map(({ id }) => id);
    const editingSourceIds = this.#editingSourceIdsCell.peek();
    if (sourceIds.every((sourceId) => editingSourceIds.has(sourceId))) {
      return this.collapseEditingSources();
    }

    this.#editingSourceIdsCell.set(new Set(sourceIds));
    return true;
  }

  /** Collapses a multi-source editing selection to its active reference source. */
  public collapseEditingSources(): boolean {
    const activeSourceId = this.#activeSourceIdCell.peek();
    if (!activeSourceId || this.#editingSourceIdsCell.peek().size <= 1) return false;

    this.#editingSourceIdsCell.set(new Set([activeSourceId]));
    return true;
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
    if (!this.font.source(sourceId) || this.#activeSourceIdCell.peek() !== null) return;

    const axes = this.font.getAxes();
    const currentLocation = this.#externalLocation.peek();
    const locationChanged = axes.some(
      (axis) => axisValue(currentLocation, axis) !== axisValue(externalLocation, axis),
    );
    if (locationChanged) return;

    batch(() => {
      this.#activeSourceIdCell.set(sourceId);
      this.#editingSourceIdsCell.set(new Set([sourceId]));
    });
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

  /**
   * Replaces the font's tracked language list as one undoable history step.
   *
   * @remarks
   * The edit is queued on the workspace lane; `font.languageIdsCell` reflects
   * the committed list once the workspace echo arrives.
   *
   * @param ids - Hyperglot language ids in display order; an empty list is
   * stored as an explicit empty list rather than removing it.
   */
  public setLanguageIds(ids: readonly string[]): void {
    this.font.editCoordinator.transaction("Set languages", () => {
      this.font.setLanguageIds(ids);
    });
  }

  /** Return the shared external location to the font default. */
  public setSourceToDefault(): void {
    this.setExternalLocation(this.font.defaultLocation());
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

  /**
   * Returns the transform from a node's own units to scene space.
   *
   * @remarks
   * Places the node's frame through its ancestors' frames, then applies the
   * node's own units. Callers that need to redraw on placement changes track
   * `scene.cell`; a parent that lays out its children (a text run) tracks its
   * own layout when read inside a reactive boundary.
   *
   * @param node - a node in the scene; its ancestors are resolved by `parentId`.
   */
  sceneTransform(node: ShiftNode): SpaceTransform<"local", "scene"> {
    const units = this.nodeDefinition(node.kind).unitsTransform(node);
    return spaceTransform(Mat.Compose(this.#frameToScene(node), units));
  }

  /**
   * Returns a point in a node's own units as a scene point.
   *
   * @param node - the node whose units `point` is measured in.
   * @param point - a point in `node`'s own units.
   */
  toScene(node: ShiftNode, point: LocalPoint): ScenePoint {
    return applyTransform(this.sceneTransform(node), point);
  }

  /**
   * Returns a scene point in a node's own units.
   *
   * @param node - the node whose units the result is measured in.
   * @param point - a scene point.
   */
  toLocal(node: ShiftNode, point: ScenePoint): LocalPoint {
    return applyTransform(invertTransform(this.sceneTransform(node)), point);
  }

  /**
   * Returns bounds in a node's own units as scene-space bounds.
   *
   * @param node - the node whose units `bounds` is measured in.
   * @param bounds - bounds in `node`'s own units.
   */
  toSceneBounds(node: ShiftNode, bounds: LocalBounds): SceneBounds {
    return transformBounds(this.sceneTransform(node), bounds);
  }

  /**
   * Returns scene-space bounds in a node's own units.
   *
   * @param node - the node whose units the result is measured in.
   * @param bounds - scene-space bounds.
   */
  toLocalBounds(node: ShiftNode, bounds: SceneBounds): LocalBounds {
    return transformBounds(invertTransform(this.sceneTransform(node)), bounds);
  }

  /**
   * Returns the canvas rectangle currently on screen in a node's own units, read without tracking.
   *
   * @param node - the node whose units the result is measured in.
   * @returns null before the canvas has a size, when nothing is known to be on screen.
   */
  visibleLocalBounds(node: ShiftNode): LocalBounds | null {
    if (this.#camera.logicalWidth <= 0 || this.#camera.logicalHeight <= 0) return null;

    const visible = this.#camera.visibleSceneBounds(0);
    const bounds = Bounds.create(
      { x: visible.minX, y: visible.minY },
      { x: visible.maxX, y: visible.maxY },
    );
    return this.toLocalBounds(node, sceneBounds(bounds));
  }

  /**
   * Returns a scene-space displacement in a node's own units.
   *
   * @param node - the node whose units the result is measured in.
   * @param vector - a scene-space displacement.
   */
  toLocalVector(node: ShiftNode, vector: SceneVector): LocalVector {
    return applyLinear(invertTransform(this.sceneTransform(node)), vector);
  }

  /**
   * Returns a canvas displacement in scene units, read without tracking.
   *
   * @param vector - a displacement in logical pixels.
   */
  toSceneVector(vector: ScreenVector): SceneVector {
    return this.#camera.screenToSceneVector(vector);
  }

  /**
   * Returns a node's scene-space bounds.
   *
   * @returns null when the node's kind reports no bounds.
   */
  nodeBounds(node: ShiftNode): SceneBounds | null {
    const bounds = this.nodeDefinition(node.kind).bounds(node);
    return bounds ? this.toSceneBounds(node, bounds) : null;
  }

  /**
   * The transform from a node's frame to the scene: Y-down, origin at the node's
   * position, nested in its parent's frame.
   *
   * @remarks
   * Frames carry placement only. Each node's units apply to its own content and
   * never to its children's frames. A parent that lays out its children
   * supplies their positions through `NodeDefinition.childPosition`.
   */
  #frameToScene(node: ShiftNode): Mat {
    const parent = this.scene.node(node.parentId);
    if (!parent) return Mat.Translate(node.position.x, node.position.y);

    const position = this.nodeDefinition(parent.kind).childPosition(parent, node) ?? node.position;
    return Mat.Compose(this.#frameToScene(parent), Mat.Translate(position.x, position.y));
  }

  /**
   * Makes a node the one being edited, clearing selection and hover.
   *
   * @remarks
   * The selection belonged to whatever was edited before. All three are
   * session records, so inside a capture undo restores the previous node and
   * its selection together.
   */
  enterNode(nodeId: NodeId): void {
    this.selection.clear();
    this.hover.clear();
    this.editing.enter(nodeId);
  }

  /**
   * Offers a double-click to the hit node's definition, then to each ancestor's.
   *
   * @returns true when a definition handled it.
   */
  doubleClickNode(target: PointerTarget): boolean {
    const hit = targetNode(this.scene, target);
    if (!hit) return false;

    return this.history.captureOrJoin("Double-click", () => {
      for (const node of [hit, ...this.scene.ancestors(hit.id)]) {
        if (this.nodeDefinition(node.kind).onDoubleClick?.(node, target)) return true;
      }
      return false;
    });
  }

  #runContentHooks(changed: ReadonlySet<ShiftRecordId>): void {
    const touched = new Set<ShiftNode>();
    for (const id of changed) {
      const node = isNodeId(id) ? this.scene.node(id) : null;
      if (node) touched.add(node);
      for (const dependent of this.scene.nodesReferencing(id)) touched.add(dependent);
    }

    for (const node of touched) {
      if (!this.scene.node(node.id)) continue;

      const definition = this.nodeDefinition(node.kind);
      if (definition.onContentChange) definition.onContentChange(node);
    }
  }

  getPointerTarget(point: ScenePoint): PointerTarget {
    const nodes = this.scene.nodes();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (!node) continue;

      const definition = this.nodeDefinition(node.kind);
      if (!definition) continue;

      const target = definition.hit(node, this.toLocal(node, point));
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

  public get xAdvance(): number {
    const sourceId = this.activeSourceId;
    if (!sourceId) return 0;

    const glyphNodes = this.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return 0;

    const [node] = glyphNodes;
    if (!node) return 0;

    return this.layerForGlyph(node.glyphId, sourceId)?.xAdvance ?? 0;
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

    this.layerForGlyph(node.glyphId, sourceId)?.setXAdvance(width);
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

    this.layerForGlyph(node.glyphId, sourceId)?.setLeftSidebearing(value);
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

    this.layerForGlyph(node.glyphId, sourceId)?.setRightSidebearing(value);
  }

  public get screenMousePositionCell(): Signal<ScreenPoint> {
    return this.#camera.screenMousePositionCell;
  }

  public getMousePosition(): ScenePoint {
    return this.#camera.mousePosition;
  }

  public getScreenMousePosition(): ScreenPoint {
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

  public screenToScene(screen: ScreenPoint): ScenePoint {
    return this.#camera.screenToScene(screen);
  }

  public get hitRadius(): number {
    return this.#camera.hitRadius;
  }

  /** @knipclassignore Indirectly consumed through Renderer. */
  public getCameraTransform(): CameraTransform {
    return {
      view: this.#camera.viewCell.peek(),
      zoom: this.#camera.zoomLevel,
      logicalWidth: this.#camera.logicalWidth,
      logicalHeight: this.#camera.logicalHeight,
    };
  }

  /** @knipclassignore Indirectly consumed through Renderer. */
  public sceneToScreen(scene: ScenePoint): ScreenPoint {
    return this.#camera.sceneToScreen(scene);
  }

  public fromScreen(screen: ScreenPoint): Coordinates {
    const scene = this.screenToScene(screen);
    return { screen, scene };
  }

  public get pan(): Point2D {
    return this.#camera.pan;
  }

  public setPan(pan: Point2D): void {
    this.#camera.setPan(pan);
  }

  public zoomIn(): void {
    this.#camera.zoomIn();
  }

  public zoomOut(): void {
    this.#camera.zoomOut();
  }

  /**
   * Frames the initial scene bounds until the user manually moves the camera.
   *
   * @param bounds - Scene-space bounds used for initial framing.
   */
  public fitInitialBounds(bounds: SceneBounds): void {
    this.#camera.fitInitialBounds(bounds);
  }

  /** Frames a glyph node's editing frame (`GlyphNodeDefinition.frameBounds`) until the user moves the camera. */
  public fitGlyphFrame(node: GlyphNode): void {
    const frame = this.nodeDefinition("glyph").frameBounds(node);
    if (frame) this.fitInitialBounds(this.toSceneBounds(node, frame));
  }

  /**
   * Fits scene-space bounds into the current canvas once.
   *
   * @param bounds - Scene-space rectangle to centre and fit.
   */
  public fitBounds(bounds: SceneBounds): void {
    this.#camera.fitToBounds(bounds);
  }

  /** Fits every bounded scene node into the viewport. */
  public zoomToFit(): void {
    let bounds: BoundsType | null = null;

    for (const node of this.scene.nodes()) {
      const nodeBounds = this.nodeBounds(node);
      if (!nodeBounds) continue;

      bounds = bounds ? Bounds.union(bounds, nodeBounds) : nodeBounds;
    }

    if (!bounds) return;

    this.fitBounds(sceneBounds(bounds));
  }

  /** Fits the current selection into the viewport. */
  public zoomToSelection(): void {
    const bounds = this.selectionSceneBounds();
    if (!bounds) return;

    this.fitBounds(bounds);
  }

  /** Sets an absolute zoom level around the viewport centre. */
  public setZoom(zoom: number): void {
    this.#camera.setZoom(zoom);
  }

  public zoomToPoint(anchor: ScreenPoint, zoomDelta: number): void {
    this.#camera.zoomToPoint(anchor, zoomDelta);
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
        case "component":
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

    const layer = this.layerForGlyph(node.glyphId, sourceId);
    if (!layer) return null;

    const inserted: SelectableId[] = [];

    this.transaction("Insert content", () => {
      for (const contour of content.contours) {
        if (contour.points.length === 0) continue;

        const contourId = layer.addContour();

        for (const pointId of layer.addPoints(
          contourId,
          contour.points.map((point) => ({
            ...point,
            x: point.x + options.offset.x,
            y: point.y + options.offset.y,
          })),
        )) {
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

    this.history.capture("Cut", () => {
      this.transaction("Cut", () => {
        selection.layer.removePoints(pointIds);
      });
      this.selection.clear();
    });
    await this.font.editCoordinator.settled();
    return true;
  }

  public async deleteSelection(mode: DeleteMode = "fit"): Promise<boolean> {
    const componentsRemoved = await this.#editSelectedComponents(
      "Delete Components",
      (layer, ids) => layer.removeComponents(ids),
    );
    if (componentsRemoved) return true;

    const selection = this.positionSelection(this.selection.ids);
    if (!selection) return false;

    const pointIds = selection.targets.points ?? [];
    const anchorIds = selection.targets.anchors ?? [];
    if (pointIds.length === 0 && anchorIds.length > 0) {
      this.transaction("Delete Anchors", () => {
        selection.layer.removeAnchors(anchorIds);
        for (const target of selection.additionalLayers) {
          target.layer.removeAnchors(target.targets.anchors ?? []);
        }
      });
      await this.#clearSelectionAfterEdit();
      return true;
    }

    if (pointIds.length === 0 || anchorIds.length > 0) return false;

    const deleted = this.history.capture("Delete", () => {
      if (!selection.layer.deletePoints(pointIds, mode)) return false;

      this.selection.clear();
      this.hover.clear();
      return true;
    });
    if (!deleted) return false;

    await this.font.editCoordinator.settled();
    return true;
  }

  /** Whether the selection is entirely components that {@link decomposeSelection} can decompose. */
  public canDecomposeSelection(): boolean {
    return this.#componentTargets(this.selection.ids) !== null;
  }

  /**
   * Replaces the selected components with their base glyphs' outlines.
   *
   * @remarks
   * Applies to every source selected for editing that has matching components,
   * as one undo step, then clears the selection.
   *
   * @returns `true` when components were decomposed; `false` when the selection
   * is not entirely components on the active source.
   */
  public async decomposeSelection(): Promise<boolean> {
    return this.#editSelectedComponents("Decompose Components", (layer, ids) =>
      layer.decomposeComponents(ids),
    );
  }

  async #editSelectedComponents(
    label: string,
    edit: (layer: GlyphLayer, componentIds: readonly ComponentId[]) => void,
  ): Promise<boolean> {
    const targets = this.#componentTargets(this.selection.ids);
    if (!targets) return false;

    this.transaction(label, () => {
      edit(targets.layer, targets.componentIds);
      for (const target of targets.additionalLayers) edit(target.layer, target.componentIds);
    });
    await this.#clearSelectionAfterEdit();
    return true;
  }

  async #clearSelectionAfterEdit(): Promise<void> {
    this.selection.clear();
    this.hover.clear();
    await this.font.editCoordinator.settled();
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
        const inserted = this.history.capture("Paste", () => {
          const ids = this.insertContent(result.content, {
            offset: this.#clipboard.nextPasteOffset(),
          });
          if (!ids) return false;

          this.selection.select(ids);
          this.setActiveTool("select");
          return true;
        });
        if (!inserted) return false;

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

    const layer = this.layerForGlyph(node.glyphId, sourceId);
    if (!layer || !layer.contour(contourIdA) || !layer.contour(contourIdB)) return;

    await this.history.captureAsync("Boolean operation", async () => {
      const previousContourIds = new Set(layer.contours.map((contour) => contour.id));
      layer.applyBooleanOp(contourIdA, contourIdB, operation);
      await this.font.editCoordinator.settled();

      const resultContourIds = layer.contours
        .filter((contour) => !previousContourIds.has(contour.id))
        .map((contour) => contour.id);
      this.selection.select(resultContourIds);
    });
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
    this.#multiSourceEditing.dispose();
    this.#renderer.destroy();
    this.#toolManager.dispose();
    this.text.dispose();
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

/** The node a pointer target belongs to, or null for blank canvas. */
function targetNode(scene: Scene, target: PointerTarget): ShiftNode | null {
  switch (target.kind) {
    case "canvas":
      return null;
    case "node":
    case "text":
      return target.node;
    case "point":
    case "anchor":
    case "segment":
    case "component":
      return scene.node(target.nodeId);
  }
}

function sameSourceIds(a: ReadonlySet<SourceId>, b: ReadonlySet<SourceId>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
