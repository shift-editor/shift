/**
 * TestEditor — a real Editor with input simulation for testing.
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

import { localPoint, scenePoint, screenPoint, type ScreenPoint } from "@shift/editor/spaces";
import { Editor } from "@shift/editor";
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
  type GlyphRecord,
  type PointId,
  type Unicode,
} from "@shift/types";
import type { Contour } from "@shift/glyph-state";
import type { SystemClipboard } from "@shift/editor/clipboard";
import { createWorkspaceStack, type WorkspaceStack } from "./workspaceStack";
import type { GlyphNode, TextRunNode } from "@shift/editor/types";
import type { FontSessionMode, WorkspaceDocumentState } from "@shared/workspace/protocol";

const DEFAULT_MODIFIERS = { shiftKey: false, altKey: false, metaKey: false };

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

export class TestEditor extends Editor {
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
    super({ font: stack.font, fontStore: stack.store, clipboard, sessionMode });
    this.#stack = stack;
    this.#clipboard = clipboard;
    registerBuiltInTools(this);
    this.setActiveTool("select");
  }

  /**
   * Creates a real workspace, a glyph, and places it in the editor scene —
   * the production pipe end to end (intents → NAPI → SQLite → echo → fold).
   */
  async startSession(name = "A", unicode: number | null = 65): Promise<this> {
    await this.#stack.createWorkspace();
    this.selectSource(this.font.defaultSource.id);

    const glyph = await this.#createAndOpenGlyph(name, unicode);
    const record = this.font.recordForName(glyph.handle.name);
    if (!record) throw new Error("created glyph did not appear in the font directory");
    this.#placeGlyph(record.id);
    return this;
  }

  /** Opens a saved package through a fresh workspace stack and places one glyph. */
  async openSession(sourcePath: string, glyphName: string): Promise<this> {
    await this.#stack.openWorkspace(sourcePath);
    this.selectSource(this.font.defaultSource.id);

    const record = this.font.recordForName(glyphName as GlyphName);
    if (!record) throw new Error(`Opened package has no ${glyphName} glyph`);
    await this.font.loadGlyph(record.id);
    this.#placeGlyph(record.id);
    return this;
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
    this.destroy();
    this.#stack.dispose();
  }

  /** Adds another glyph to the workspace font and loads its local model. */
  async addGlyph(name: string, unicode: number | null): Promise<void> {
    await this.#createAndOpenGlyph(name, unicode);
  }

  async #createAndOpenGlyph(name: string, unicode: number | null): Promise<Glyph> {
    const glyphId = mintGlyphId();
    const sourceId = this.font.defaultSource.id;
    const applied = await this.history.withoutRecording(() =>
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

    return this.font.loadGlyph(record.id);
  }

  /** The canvas's text run; the editor route creates it on the first open. */
  get textRun(): TextRunNode | null {
    return this.scene.nodesOfKind("textRun")[0] ?? null;
  }

  /** The glyph edited in place in {@link textRun}. */
  get runGlyph(): GlyphNode | null {
    const run = this.textRun;
    return run ? this.nodeDefinition("textRun").childGlyph(run) : null;
  }

  /** Opens a glyph as the editor route does: the canvas run becomes that glyph, edited in place. */
  #placeGlyph(glyphId: GlyphId): void {
    const item = this.text.glyphItem(glyphId);
    if (!item || !this.glyphForId(glyphId)) throw new Error("placed glyph is not loaded");
    const record = this.text.createRun([item]);
    const run = this.scene.createNode<TextRunNode>({
      kind: "textRun",
      runId: record.id,
      size: this.font.metricsCell.peek().unitsPerEm,
      position: { x: 0, y: 0 },
    });
    const child = this.nodeDefinition("textRun").editItem(run, item.id);
    if (!child) throw new Error("placed glyph is not loaded");
    this.enterNode(child.id);
  }

  /** Awaits every queued and in-flight apply; geometry reads confirmed truth after. */
  async settle(): Promise<this> {
    await this.font.editCoordinator.settled();
    return this;
  }

  get clipboardBuffer(): string {
    return this.#clipboard.buffer;
  }

  get pointCount(): number {
    return this.glyphLayer?.pointCount ?? 0;
  }

  get glyphLayer(): GlyphLayer | null {
    const sourceId = this.activeSourceId;
    if (!sourceId) return null;

    const node = this.glyphNode;
    if (!node) return null;

    return this.layerForGlyph(node.glyphId, sourceId) ?? null;
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
    return this.scene.nodesOfKind("glyph")[0] ?? null;
  }

  get sceneGlyphRenderModel(): GlyphRenderModel | null {
    const node = this.glyphNode;
    if (!node) return null;

    return (
      this.glyphForId(node.glyphId)?.renderModelAt(
        this.externalLocationCell,
        this.activeSourceIdCell,
      ) ?? null
    );
  }

  get glyphRecord(): GlyphRecord | null {
    const node = this.glyphNode;
    if (!node) return null;

    return this.font.recordForId(node.glyphId);
  }

  get glyphContours(): readonly Contour[] {
    return this.glyphLayer?.contours ?? [];
  }

  get openContour(): Contour | null {
    return this.glyphContours.find((contour) => !contour.closed) ?? null;
  }

  async click(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): Promise<this> {
    const mods = { ...DEFAULT_MODIFIERS, ...options };
    this.toolManager.handlePointerDown(screenPoint(x, y), mods);
    this.toolManager.handlePointerUp(screenPoint(x, y), mods);

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

    return this.sceneToScreen(this.toScene(node, localPoint(point.x, point.y)));
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
      (point) => this.sceneToScreen(scenePoint(point.x, point.y)),
      (screen) => this.screenToScene(screen),
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
      (screen) => this.toLocal(node, this.screenToScene(screen)),
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
    const bounds = this.selectionBounds();
    return bounds ? Bounds.toRect(bounds) : null;
  }

  pointerDown(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.toolManager.handlePointerDown(screenPoint(x, y), { ...DEFAULT_MODIFIERS, ...options });
    return this;
  }

  pointerMove(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.toolManager.handlePointerMove(
      screenPoint(x, y),
      { ...DEFAULT_MODIFIERS, ...options },
      { force: true },
    );
    this.toolManager.flushPointerMoves();
    return this;
  }

  pointerUp(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.toolManager.handlePointerUp(screenPoint(x, y), { ...DEFAULT_MODIFIERS, ...options });
    return this;
  }

  keyDown(key: string, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    const mods = { ...DEFAULT_MODIFIERS, ...options };
    this.toolManager.handleKeyDown({
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

  selectTool(name: ToolName): this {
    this.setActiveTool(name);
    return this;
  }

  #assertWorkspaceSettled(): void {
    if (!this.font.editCoordinator.settledCell.value) {
      throw new Error("Workspace edits are pending; await the user action before reading geometry");
    }
  }
}
