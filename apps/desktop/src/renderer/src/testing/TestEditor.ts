/**
 * TestEditor — a real Editor behind a stable test API, with input simulation.
 *
 * Usage:
 *   const editor = new TestEditor();
 *   editor.selectTool("pen");
 *   await editor.click(100, 200);
 *   expect(editor.pointCount).toBe(1);
 *
 * Editing sessions return when glyph mutations flow through workspace
 * change sets; until then the editor surface under test is tool/input state.
 */

import {
  localPoint,
  scenePoint,
  screenPoint,
  type LocalPoint,
  type ScreenPoint,
} from "@shift/editor/spaces";
import { Editor, type HistoryCapture } from "@shift/editor";
import { effect, track, untracked } from "@shift/editor/signals";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import type { Glyph, GlyphRenderModel, GlyphLayer } from "@shift/editor/model";
import type { ToolName } from "@shift/editor/tools";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { Bounds, type Point2D, type Rect2D } from "@shift/geo";
import {
  mintGlyphId,
  mintLayerId,
  type GlyphId,
  type GlyphName,
  type AnchorId,
  type Axis,
  type NodeId,
  type GlyphRecord,
  type PointId,
  type RunId,
  type Unicode,
} from "@shift/types";
import type { Contour } from "@shift/glyph-state";
import type { SystemClipboard } from "@shift/editor/clipboard";
import { createWorkspaceStack, type WorkspaceStack } from "./workspaceStack";
import type {
  CursorType,
  GlyphNode,
  GlyphOutlineTarget,
  NodeKind,
  NodeOfKind,
  ShiftNode,
  TextRunNode,
} from "@shift/editor/types";
import type { FontSessionMode, WorkspaceDocumentState } from "@shared/workspace/protocol";

const DEFAULT_MODIFIERS = { shiftKey: false, altKey: false, metaKey: false };

type PlacedGlyphs = NonNullable<
  ReturnType<ReturnType<Editor["text"]["layoutCell"]>["peek"]>
>["placedGlyphs"];
type EditingLayerMatches = ReturnType<Editor["editingLayerMatchesCell"]["peek"]>;
type SceneReference = Parameters<Editor["scene"]["nodesReferencing"]>[0];
type NewSceneNode = Parameters<Editor["scene"]["createNode"]>[0];

/** What a reactive reader saw, oldest first; `stop()` ends the reading. */
interface ReactiveWatch<T> {
  readonly values: readonly T[];
  stop(): void;
}

interface DragInput {
  down: Point2D;
  start: Point2D;
  end: Point2D;
  options?: Partial<typeof DEFAULT_MODIFIERS>;
}

interface DragResult {
  down: Point2D;
  start: Point2D;
  end: Point2D;
  delta: Point2D;
}

/**
 * The {@link Editor} members tests may use directly: its user actions and the
 * domain objects (selection, font, text) a user works with.
 *
 * @remarks
 * Everything else is reached through a TestEditor helper, so restructuring the
 * editor changes this list and the helpers, not the tests. Shrink the list as
 * helpers replace entries; do not add tool, scene, history or signal internals.
 */
const EDITOR_SURFACE = [
  "activeSource",
  "activeSourceId",
  "addAnchorAt",
  "addAnchorAtPointer",
  "addComponent",
  "attachRenderSurfaces",
  "boolean",
  "camera",
  "canDecomposeSelection",
  "collapseEditingSources",
  "componentTransformSelection",
  "copy",
  "createGlyph",
  "createGlyphAndAddComponent",
  "createGlyphsForUnicodes",
  "createSource",
  "currentModifiers",
  "cursor",
  "cut",
  "deleteSelection",
  "destroy",
  "duplicateSelection",
  "editing",
  "editingSourceIds",
  "externalLocation",
  "fitGlyphFrame",
  "flushMousePosition",
  "font",
  "getPointerTarget",
  "getToolShortcuts",
  "glyphForId",
  "handlesVisible",
  "hideHandles",
  "hitRadius",
  "hitRadiusIn",
  "hover",
  "input",
  "insertContent",
  "isDragging",
  "layerForGeometry",
  "nodeBounds",
  "object",
  "pan",
  "paste",
  "positionSelection",
  "redo",
  "registerTool",
  "renameAnchor",
  "requestTemporaryTool",
  "returnFromTemporaryTool",
  "sceneToScreen",
  "screenToScene",
  "selectAll",
  "selectedComponentsAnchored",
  "selection",
  "selectionBounds",
  "selectSource",
  "selectSourceForEditing",
  "setAnchorAxis",
  "setCameraRect",
  "setExternalLocation",
  "setLanguageIds",
  "setLeftSidebearing",
  "setRightSidebearing",
  "setSelectedComponentsAnchored",
  "setSourceToDefault",
  "setXAdvance",
  "setZoom",
  "snapping",
  "text",
  "textEditing",
  "toggleAllSourcesForEditing",
  "toLocal",
  "tool",
  "toolIf",
  "toolRegistry",
  "toScene",
  "transaction",
  "transformTarget",
  "undo",
  "updateMousePosition",
  "xAdvance",
  "zoom",
  "zoomToFit",
  "zoomToSelection",
] as const satisfies readonly (keyof Editor)[];

type EditorSurface = (typeof EDITOR_SURFACE)[number];

/**
 * In-memory {@link SystemClipboard} for tests. The buffer is directly
 * readable via {@link TestEditor.clipboardBuffer} so tests can assert on
 * what the Editor wrote without needing a round-trip.
 */
class InMemorySystemClipboard implements SystemClipboard {
  buffer = "";
  async writeText(text: string): Promise<void> {
    this.buffer = text;
  }
  async readText(): Promise<string> {
    return this.buffer;
  }
}

// Declaration merging types the members the static block below forwards to the wrapped editor.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export interface TestEditor extends Pick<Editor, EditorSurface> {}

export class TestEditor {
  static {
    for (const name of EDITOR_SURFACE) {
      Object.defineProperty(TestEditor.prototype, name, {
        get(this: TestEditor) {
          const value: unknown = this.#editor[name];
          return typeof value === "function" ? value.bind(this.#editor) : value;
        },
      });
    }
  }

  readonly #editor: Editor;
  readonly #clipboard: InMemorySystemClipboard;
  readonly #stack: WorkspaceStack;

  /**
   * Creates a real editor stack with the requested immutable session capability.
   *
   * @param sessionMode - Presentation and interaction capability under test.
   */
  constructor(sessionMode: FontSessionMode = "workspace") {
    const stack = createWorkspaceStack();
    const clipboard = new InMemorySystemClipboard();
    const editor = new Editor({ font: stack.font, fontStore: stack.store, clipboard, sessionMode });
    this.#editor = editor;
    this.#stack = stack;
    this.#clipboard = clipboard;
    registerBuiltInTools(editor);
    editor.setActiveTool("select");
  }

  /**
   * Creates a real workspace, a glyph, and places it in the editor scene —
   * the production pipe end to end (intents → NAPI → SQLite → echo → fold).
   */
  async startSession(name = "A", unicode: number | null = 65): Promise<this> {
    await this.#stack.createWorkspace();
    this.#editor.selectSource(this.#editor.font.defaultSource.id);

    const glyph = await this.#createAndOpenGlyph(name, unicode);
    const record = this.#editor.font.recordForName(glyph.handle.name);
    if (!record) throw new Error("created glyph did not appear in the font directory");
    this.#placeGlyph(record.id);
    return this;
  }

  /** Opens a saved package through a fresh workspace stack and places one glyph. */
  async openSession(sourcePath: string, glyphName: string): Promise<this> {
    await this.#stack.openWorkspace(sourcePath);
    this.#editor.selectSource(this.#editor.font.defaultSource.id);

    const record = this.#editor.font.recordForName(glyphName as GlyphName);
    if (!record) throw new Error(`Opened package has no ${glyphName} glyph`);
    await this.#editor.font.loadGlyph(record.id);
    this.#placeGlyph(record.id);
    return this;
  }

  /**
   * The wrapped editor, for handing to desktop code under test such as
   * commands, keyboard routing and the glyph catalog.
   *
   * @remarks
   * Observe and drive the editor through TestEditor itself; reading through
   * this getter couples the test to the editor's internals again.
   */
  get editor(): Editor {
    return this.#editor;
  }

  /** The real renderer edit coordinator, for desktop components built around this editor. */
  get workspaceEditCoordinator(): WorkspaceStack["editCoordinator"] {
    return this.#stack.editCoordinator;
  }

  /** Flushes pending edits, saves to a new target, and adopts it. */
  saveAs(sourcePath: string): Promise<WorkspaceDocumentState> {
    return this.#stack.editCoordinator.save(sourcePath);
  }

  /** Flushes pending edits and saves to the current target. */
  save(): Promise<WorkspaceDocumentState> {
    return this.#stack.editCoordinator.save(null);
  }

  /** Closes the clean workspace and permanently disposes this test stack. */
  async closeSession(): Promise<void> {
    await this.settle();
    await this.#stack.closeWorkspace();
    this.#editor.destroy();
    this.#stack.dispose();
  }

  /** Adds another glyph to the workspace font and loads its local model. */
  async addGlyph(name: string, unicode: number | null): Promise<void> {
    await this.#createAndOpenGlyph(name, unicode);
  }

  async #createAndOpenGlyph(name: string, unicode: number | null): Promise<Glyph> {
    const glyphId = mintGlyphId();
    const sourceId = this.#editor.font.defaultSource.id;
    const applied = await this.#editor.history.withoutRecording(() =>
      this.#stack.editCoordinator.apply([
        {
          kind: "createGlyph",
          createGlyph: {
            glyphId,
            name: name as GlyphName,
            unicodes: (unicode === null ? [] : [unicode]) as Unicode[],
          },
        },
        {
          kind: "createGlyphLayer",
          createGlyphLayer: {
            layerId: mintLayerId(),
            glyphId,
            sourceId,
          },
        },
      ]),
    );

    const record = applied.next?.glyphs?.find((glyph) => glyph.name === name);
    if (!record) throw new Error("createGlyph did not echo the new record");

    return this.#editor.font.loadGlyph(record.id);
  }

  /** The canvas's text run; the editor route creates it on the first open. */
  get textRun(): TextRunNode | null {
    return this.#editor.scene.first("textRun");
  }

  /** The glyph edited in place in {@link textRun}. */
  get runGlyph(): GlyphNode | null {
    const run = this.textRun;
    return run ? this.#editor.nodeDefinition("textRun").childGlyph(run) : null;
  }

  /** Opens a glyph as the editor route does: the canvas run becomes that glyph, edited in place. */
  #placeGlyph(glyphId: GlyphId): void {
    const item = this.#editor.text.glyphItem(glyphId);
    if (!item || !this.#editor.glyphForId(glyphId)) throw new Error("placed glyph is not loaded");
    const record = this.#editor.text.createRun([item]);
    const run = this.#editor.scene.createNode<TextRunNode>({
      kind: "textRun",
      runId: record.id,
      size: this.#editor.font.metricsCell.peek().unitsPerEm,
      position: { x: 0, y: 0 },
    });
    const child = this.#editor.nodeDefinition("textRun").editItem(run, item.id);
    if (!child) throw new Error("placed glyph is not loaded");
    this.#editor.enterNode(child.id);
  }

  /**
   * Adds a weight axis and moves to a location between its default and maximum,
   * where no source sits, so the displayed glyph is interpolated and read-only.
   */
  async moveToInterpolatedLocation(): Promise<this> {
    const axisId = this.#editor.font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await this.settle();
    this.#editor.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 550 }));
    return this;
  }

  /**
   * Awaits every queued and in-flight apply, then text shaping and the glyph
   * loads it asks for; geometry and text reads see confirmed truth after.
   */
  async settle(): Promise<this> {
    await this.#editor.font.editCoordinator.settled();
    await this.#editor.text.settled();
    return this;
  }

  get clipboardBuffer(): string {
    return this.#clipboard.buffer;
  }

  get pointCount(): number {
    return this.glyphLayer?.pointCount ?? 0;
  }

  get glyphLayer(): GlyphLayer | null {
    const sourceId = this.#editor.activeSourceId;
    if (!sourceId) return null;

    const node = this.glyphNode;
    if (!node) return null;

    return this.#editor.layerForGlyph(node.glyphId, sourceId) ?? null;
  }

  requireGlyphLayer(): GlyphLayer {
    const layer = this.glyphLayer;
    if (!layer) throw new Error("Expected glyph layer");

    return layer;
  }

  pointPosition(pointId: PointId): Point2D {
    this.#assertWorkspaceSettled();
    const point = this.requireGlyphLayer().point(pointId);
    if (!point) throw new Error("Expected source point");

    return { x: point.x, y: point.y };
  }

  anchorPosition(anchorId: AnchorId): Point2D {
    this.#assertWorkspaceSettled();
    const anchor = this.requireGlyphLayer().anchor(anchorId);
    if (!anchor) throw new Error("Expected source anchor");

    return { x: anchor.x, y: anchor.y };
  }

  async drawOpenContour(points: readonly Point2D[]): Promise<readonly PointId[]> {
    this.selectTool("pen");
    for (const point of points) {
      await this.clickLocal(point.x, point.y);
    }

    const contour = this.openContour;
    if (!contour) throw new Error("Expected open contour");

    return contour.points.map((point) => point.id);
  }

  get glyphNode(): GlyphNode | null {
    return this.#editor.scene.first("glyph");
  }

  get sceneGlyphRenderModel(): GlyphRenderModel | null {
    const node = this.glyphNode;
    if (!node) return null;

    return (
      this.#editor
        .glyphForId(node.glyphId)
        ?.renderModelAt(this.#editor.externalLocationCell, this.#editor.activeSourceIdCell) ?? null
    );
  }

  get glyphRecord(): GlyphRecord | null {
    const node = this.glyphNode;
    if (!node) return null;

    return this.#editor.font.recordForId(node.glyphId);
  }

  get glyphContours(): readonly Contour[] {
    return this.glyphLayer?.contours ?? [];
  }

  get openContour(): Contour | null {
    return this.glyphContours.find((contour) => !contour.closed) ?? null;
  }

  async click(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): Promise<this> {
    const mods = { ...DEFAULT_MODIFIERS, ...options };
    this.#editor.toolManager.handlePointerDown(screenPoint(x, y), mods);
    this.#editor.toolManager.handlePointerUp(screenPoint(x, y), mods);

    return this.settle();
  }

  /**
   * Projects a glyph-local (UPM) point to canvas pixels through the glyph node's
   * transform and the camera.
   *
   * @param point - a position in the placed glyph's own units, such as a point,
   * handle, or bounds value read from its layer.
   * @throws {Error} when no glyph node is open.
   */
  localToScreen(point: Point2D): ScreenPoint {
    const node = this.glyphNode;
    if (!node) throw new Error("localToScreen needs an open glyph node");

    return this.#editor.sceneToScreen(this.#editor.toScene(node, localPoint(point.x, point.y)));
  }

  /**
   * Clicks at glyph-local (UPM) coordinates, projecting through the glyph node and camera.
   *
   * @remarks
   * Use when a test asserts exact point positions; plain {@link click} takes
   * screen coordinates.
   */
  async clickLocal(
    x: number,
    y: number,
    options?: Partial<typeof DEFAULT_MODIFIERS>,
  ): Promise<this> {
    const screen = this.localToScreen({ x, y });
    return this.click(screen.x, screen.y, options);
  }

  /**
   * Drags through scene coordinates with a distinct threshold-crossing sample.
   *
   * @param input - Scene-space pointer-down origin, threshold-crossing first
   * move, and final pointer position.
   * @returns The scene-space drag points observed through the camera and the
   * canonical delta from `down` to `end`.
   */
  dragScene(input: DragInput): Promise<DragResult> {
    return this.#drag(
      input,
      (point) => this.#editor.sceneToScreen(scenePoint(point.x, point.y)),
      (screen) => this.#editor.screenToScene(screen),
    );
  }

  /**
   * Drags through the glyph node's own (UPM) coordinates with a distinct
   * threshold-crossing sample.
   *
   * @param input - Glyph-local pointer-down origin, threshold-crossing first
   * move, and final pointer position.
   * @returns The glyph-local drag points observed through the node and camera,
   * and the canonical delta from `down` to `end`.
   * @throws {Error} when no glyph node is open.
   */
  dragLocal(input: DragInput): Promise<DragResult> {
    const node = this.glyphNode;
    if (!node) throw new Error("dragLocal needs an open glyph node");

    return this.#drag(
      input,
      (point) => this.localToScreen(point),
      (screen) => this.#editor.toLocal(node, this.#editor.screenToScene(screen)),
    );
  }

  async #drag(
    input: DragInput,
    toScreen: (point: Point2D) => ScreenPoint,
    fromScreen: (screen: ScreenPoint) => Point2D,
  ): Promise<DragResult> {
    const downScreen = toScreen(input.down);
    const startScreen = toScreen(input.start);
    const endScreen = toScreen(input.end);

    this.pointerDown(downScreen.x, downScreen.y, input.options);
    this.pointerMove(startScreen.x, startScreen.y, input.options);
    this.pointerMove(endScreen.x, endScreen.y, input.options);
    this.pointerUp(endScreen.x, endScreen.y, input.options);

    await this.settle();

    const down = fromScreen(downScreen);
    const start = fromScreen(startScreen);
    const end = fromScreen(endScreen);

    return {
      down,
      start,
      end,
      delta: {
        x: end.x - down.x,
        y: end.y - down.y,
      },
    };
  }

  /**
   * Returns the selection's bounds in the glyph's own units as a rectangle.
   *
   * @returns null when nothing is selected or the selection spans nodes.
   */
  selectionLocalRect(): Rect2D | null {
    const bounds = this.#editor.selectionBounds();
    return bounds ? Bounds.toRect(bounds) : null;
  }

  pointerDown(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.#editor.toolManager.handlePointerDown(screenPoint(x, y), {
      ...DEFAULT_MODIFIERS,
      ...options,
    });
    return this;
  }

  pointerMove(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.#editor.toolManager.handlePointerMove(
      screenPoint(x, y),
      { ...DEFAULT_MODIFIERS, ...options },
      { force: true },
    );
    this.#editor.toolManager.flushPointerMoves();
    return this;
  }

  pointerUp(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.#editor.toolManager.handlePointerUp(screenPoint(x, y), {
      ...DEFAULT_MODIFIERS,
      ...options,
    });
    return this;
  }

  keyDown(key: string, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    const mods = { ...DEFAULT_MODIFIERS, ...options };
    this.#editor.toolManager.handleKeyDown({
      key,
      code: key,
      shiftKey: mods.shiftKey,
      altKey: mods.altKey,
      metaKey: mods.metaKey,
      ctrlKey: false,
      preventDefault: () => {},
    } as KeyboardEvent);
    return this;
  }

  async pressKey(key: string, options?: Partial<typeof DEFAULT_MODIFIERS>): Promise<this> {
    this.keyDown(key, options);

    return this.settle();
  }

  escape(): this {
    return this.keyDown("Escape");
  }

  /** Abandons the in-flight pointer gesture, as losing pointer capture does. */
  cancelGesture(): this {
    this.#editor.toolManager.cancelPointerGesture();
    return this;
  }

  /** The cursor the active tool asks for at the current pointer position. */
  get toolCursor(): CursorType | null {
    return this.#editor.toolManager.activeTool?.cursorCell.value ?? null;
  }

  /**
   * Returns the active tool as the given class, for tool tests that read the
   * tool's own public state.
   *
   * @throws {Error} when the active tool is not an instance of `type`.
   */
  activeToolAs<T>(type: abstract new (...args: never[]) => T): T {
    const tool = this.#editor.toolManager.activeTool;
    if (!(tool instanceof type)) throw new Error(`Expected active tool to be ${type.name}`);

    return tool;
  }

  selectTool(name: ToolName): this {
    this.#editor.setActiveTool(name);
    return this;
  }

  /**
   * Queues a pointer move without draining it, as a browser move that arrives
   * between animation frames does.
   *
   * @remarks
   * The next {@link pointerMove} or {@link pointerUp} drains it. Use to test that
   * a release still honours the last sample (and its modifiers) the tool never saw.
   */
  queuePointerMove(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.#editor.toolManager.handlePointerMove(screenPoint(x, y), {
      ...DEFAULT_MODIFIERS,
      ...options,
    });
    return this;
  }

  /**
   * Places the open glyph's scene node at a scene position, as dragging the
   * node on the canvas does.
   *
   * @throws {Error} when no glyph node is open.
   */
  placeGlyphNodeAt(position: Point2D): this {
    const node = this.glyphNode;
    if (!node) throw new Error("placeGlyphNodeAt needs an open glyph node");

    return this.moveNode(node.id, position);
  }

  /**
   * Sets the open text run's type size in scene units.
   *
   * @throws {Error} when no text run is open.
   */
  setTextRunSize(size: number): this {
    const run = this.textRun;
    if (!run) throw new Error("setTextRunSize needs an open text run");

    this.#editor.scene.updateNode({ id: run.id, size });
    return this;
  }

  /**
   * The pre-gesture outline Select draws behind a live edit of the open glyph,
   * as each root contour's point positions.
   *
   * @returns null when no ghost is drawn: Select is not active, or no edit is live.
   */
  get editGhostContours(): readonly (readonly Point2D[])[] | null {
    const node = this.glyphNode;
    const sourceId = this.#editor.activeSourceId;
    if (!node || !sourceId || this.#editor.tool?.id !== "select") return null;

    const base = this.#editor.layerForGlyph(node.glyphId, sourceId)?.editBaseGeometryCell.peek();
    if (!base) return null;

    return base.contours.map((contour) => contour.points.map(({ x, y }) => ({ x, y })));
  }

  /**
   * How each non-reference layer being edited together pairs its points with
   * the reference layer's, keyed by target layer.
   */
  get editingLayerMatches(): EditingLayerMatches {
    return this.#editor.editingLayerMatchesCell.peek();
  }

  /**
   * Every placed scene node, parents before children and siblings in order.
   *
   * @remarks
   * Reactive: an effect that calls this reruns when a node is added, removed,
   * or changed, and only then.
   */
  sceneNodes(): readonly ShiftNode[] {
    return this.#editor.scene.cell.value.nodes;
  }

  /** The placed scene node with `nodeId`, or null when there is none. */
  sceneNode(nodeId: NodeId): ShiftNode | null {
    return this.#editor.scene.node(nodeId);
  }

  /** Every placed node of `kind`, in scene order. */
  nodesOfKind<K extends NodeKind>(kind: K): readonly NodeOfKind<K>[] {
    return this.#editor.scene.nodesOfKind(kind);
  }

  /** The first placed node of `kind` in scene order, or null when there is none. */
  firstNode<K extends NodeKind>(kind: K): NodeOfKind<K> | null {
    return this.#editor.scene.first(kind);
  }

  /**
   * The scene's one node of `kind`, or null with none or several.
   *
   * @remarks
   * Reactive: an effect that calls this reruns when the nodes of `kind` change.
   */
  onlyNode<K extends NodeKind>(kind: K): NodeOfKind<K> | null {
    return this.#editor.scene.onlyCell(kind).value;
  }

  /**
   * The placed nodes that show a run or a glyph.
   *
   * @remarks
   * Reactive: an effect that calls this reruns when the nodes showing `id` change.
   */
  nodesReferencing(id: SceneReference): readonly ShiftNode[] {
    return this.#editor.scene.nodesReferencing(id);
  }

  /** Places another node in the scene, as opening a glyph beside the current one does. */
  placeNode(node: NewSceneNode): ShiftNode {
    return this.#editor.scene.createNode(node);
  }

  /** Replaces every placed node with `nodes`, as restoring a saved canvas does. */
  replaceSceneNodes(nodes: readonly ShiftNode[]): this {
    this.#editor.scene.setNodes(nodes);
    return this;
  }

  /** Moves a placed node to a scene position. */
  moveNode(nodeId: NodeId, position: Point2D): this {
    this.#editor.scene.updateNode({ id: nodeId, position });
    return this;
  }

  /** Removes a placed node from the scene. */
  removeNode(nodeId: NodeId): this {
    this.#editor.scene.deleteNode(nodeId);
    return this;
  }

  /** Removes every placed node, as navigating away from the canvas does. */
  clearScene(): this {
    this.#editor.scene.clear();
    return this;
  }

  /**
   * Shows another glyph in the open glyph node, keeping the node in place.
   *
   * @throws {Error} when no glyph node is open.
   */
  showGlyphInNode(glyphId: GlyphId): this {
    const node = this.glyphNode;
    if (!node) throw new Error("showGlyphInNode needs an open glyph node");

    this.#editor.scene.updateNode({ id: node.id, glyphId });
    return this;
  }

  /** The comparison outlines drawn around a glyph node, in draw order. */
  visibleOutlines(nodeId: NodeId): readonly GlyphOutlineTarget[] {
    return this.#editor.nodeDefinition("glyph").visibleOutlines(nodeId);
  }

  /** Shows or hides one comparison outline, as clicking its source or instance row does. */
  toggleOutline(target: GlyphOutlineTarget): this {
    this.#editor.nodeDefinition("glyph").outlines.toggle(target);
    return this;
  }

  /**
   * How the open glyph node draws each of its point handles, keyed by point.
   *
   * @throws {Error} when no glyph node is open.
   */
  handleStates() {
    const node = this.glyphNode;
    if (!node) throw new Error("handleStates needs an open glyph node");

    return this.#editor.nodeDefinition("glyph").handleStates(node);
  }

  /** Flushes pending edits and reads the document's save state (dirty, needs Save As). */
  documentState(): Promise<WorkspaceDocumentState | null> {
    return this.#editor.font.editCoordinator.state();
  }

  /**
   * Sends the workspace an edit it refuses (a second glyph named like the
   * opened one), as a conflicting model write does.
   *
   * @returns the apply, which rejects once the workspace refuses it.
   */
  submitRejectedEdit(): Promise<unknown> {
    const name = this.glyphRecord?.name;
    if (!name) throw new Error("submitRejectedEdit needs an open glyph");

    return this.#editor.font.editCoordinator.apply([
      { kind: "createGlyph", createGlyph: { glyphId: mintGlyphId(), name, unicodes: [] } },
    ]);
  }

  /**
   * Records `body` as one undoable editor action and returns its result.
   * A throwing body records nothing.
   */
  recordAction<T>(label: string, body: () => T): T {
    return this.#editor.history.capture(label, body);
  }

  /** Asynchronous {@link recordAction}: a rejecting body records nothing. */
  recordActionAsync<T>(label: string, body: () => Promise<T>): Promise<T> {
    return this.#editor.history.captureAsync(label, body);
  }

  /**
   * Opens one undoable editor action that spans several calls; `finish()` on
   * the returned capture closes it.
   */
  beginAction(label: string): HistoryCapture {
    return this.#editor.history.begin(label);
  }

  /** Whether an undoable editor action is still open. */
  get recordingAction(): boolean {
    return this.#editor.history.capturing;
  }

  /** The font's tracked language ids, or null when the font tracks none. */
  get trackedLanguageIds(): readonly string[] | null {
    return this.#editor.font.languageIdsCell.peek();
  }

  /** The axes users set directly, in font order. */
  get externalAxes(): readonly Axis[] {
    return this.#editor.font.externalAxesCell.peek();
  }

  /**
   * Records what a renderer reading `layer` sees: `read` runs now and again
   * each time the layer publishes a change of the given kind.
   *
   * @param change - `"positions"` for coordinate changes, `"structure"` for
   * contours and point ownership, `"geometry"` for the full published geometry.
   */
  watchLayer<T>(
    layer: GlyphLayer,
    change: "positions" | "structure" | "geometry",
    read: (layer: GlyphLayer) => T,
  ): ReactiveWatch<T> {
    const values: T[] = [];
    const subscription = effect(() => {
      if (change === "positions") track(layer.buffersChangedCell);
      else if (change === "structure") track(layer.structureCell);
      else track(layer.geometryCell);
      values.push(untracked(() => read(layer)));
    });

    return { values, stop: () => subscription.dispose() };
  }

  /** Records a render model's advance now and each time it republishes. */
  watchRenderedAdvance(model: GlyphRenderModel): ReactiveWatch<number> {
    const values: number[] = [];
    const subscription = effect(() => {
      values.push(model.xAdvanceCell.value);
    });

    return { values, stop: () => subscription.dispose() };
  }

  /**
   * Starts a drag through glyph-local coordinates and holds it before release,
   * so the edit is previewed but not committed.
   *
   * @throws {Error} when no glyph node is open.
   */
  holdDragLocal(input: DragInput): this {
    const down = this.localToScreen(input.down);
    const start = this.localToScreen(input.start);
    const end = this.localToScreen(input.end);

    this.pointerDown(down.x, down.y, input.options);
    this.pointerMove(start.x, start.y, input.options);
    return this.pointerMove(end.x, end.y, input.options);
  }

  /**
   * The width a text run lays out to: the sum of its glyph advances and kerning.
   *
   * @returns null when the run does not exist.
   */
  runAdvance(runId: RunId): number | null {
    return this.#editor.text.layoutCell(runId).peek()?.totalAdvance ?? null;
  }

  /**
   * The glyphs a text run lays out, in line and visual order, each with its
   * resolved glyph, advance box edge and outline origin.
   *
   * @returns an empty list when the run does not exist.
   */
  runPlacedGlyphs(runId: RunId): PlacedGlyphs {
    return this.#editor.text.layoutCell(runId).peek()?.placedGlyphs ?? [];
  }

  /**
   * The caret cluster a click at `point` in the open text run lands on.
   *
   * @param point - a position in the run's own coordinates.
   * @returns null when the point is outside every line's advance boxes.
   * @throws {Error} when no text run is open.
   */
  runCaretAt(point: LocalPoint): number | null {
    const run = this.textRun;
    if (!run) throw new Error("runCaretAt needs an open text run");

    return this.#editor.nodeDefinition("textRun").caretAt(run, point);
  }

  /**
   * The spacing gaps between neighbouring glyphs of the open text run, in run
   * order, as the Spacing tool measures them.
   *
   * @throws {Error} when no text run is open.
   */
  runSpacingGaps() {
    const run = this.textRun;
    if (!run) throw new Error("runSpacingGaps needs an open text run");

    return this.#editor.nodeDefinition("textRun").spacingGaps(run);
  }

  /**
   * The selection box's rectangle in scene coordinates, where the canvas draws it.
   *
   * @returns null when nothing is selected.
   */
  selectionSceneRect(): Rect2D | null {
    const bounds = this.#editor.selectionSceneBoundsCell.peek();
    return bounds ? Bounds.toRect(bounds) : null;
  }

  /**
   * The model the canvas draws a glyph from at the editor's current location
   * and source.
   *
   * @returns null when the glyph is not loaded.
   */
  renderModelFor(glyphId: GlyphId): GlyphRenderModel | null {
    return (
      this.#editor
        .glyphForId(glyphId)
        ?.renderModelAt(this.#editor.externalLocationCell, this.#editor.activeSourceIdCell) ?? null
    );
  }

  #assertWorkspaceSettled(): void {
    if (!this.#editor.font.editCoordinator.settledCell.value) {
      throw new Error("Workspace edits are pending; await the user action before reading geometry");
    }
  }
}
