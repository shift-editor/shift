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

import { Editor } from "@/lib/editor/Editor";
import type { Glyph, GlyphRenderModel, GlyphLayer } from "@/lib/model/Glyph";
import type { ToolName } from "@/lib/tools/core";
import { registerBuiltInTools } from "@/lib/tools/tools";
import type { Point2D } from "@shift/geo";
import {
  mintGlyphId,
  mintLayerId,
  mintNodeId,
  type GlyphId,
  type GlyphName,
  type AnchorId,
  type GlyphRecord,
  type PointId,
  type Unicode,
} from "@shift/types";
import type { Contour } from "@shift/glyph-state";
import type { SystemClipboard } from "@/lib/clipboard";
import { createWorkspaceStack, type WorkspaceStack } from "./workspaceStack";
import type { GlyphNode } from "@/types/node";
import type { WorkspaceDocumentState } from "@shared/workspace/protocol";

const DEFAULT_MODIFIERS = { shiftKey: false, altKey: false, metaKey: false };

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

  constructor() {
    const stack = createWorkspaceStack();
    const clipboard = new InMemorySystemClipboard();
    super({ font: stack.font, fontStore: stack.store, clipboard });
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
    const applied = await this.#stack.editCoordinator.apply([
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
    ]);

    const record = applied.next?.glyphs?.find((glyph) => glyph.name === name);
    if (!record) throw new Error("createGlyph did not echo the new record");

    return this.font.loadGlyph(record.id);
  }

  #placeGlyph(glyphId: GlyphId): void {
    this.scene.setNodes([
      {
        id: mintNodeId(),
        type: "node",
        kind: "glyph",
        parentId: null,
        index: "a0",
        glyphId,
        sourceId: this.font.defaultSource.id,
        position: { x: 0, y: 0 },
      },
    ]);
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

    return this.glyphForId(node.glyphId)?.layerForSource(sourceId) ?? null;
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
      await this.clickGlyphLocal(point.x, point.y);
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
    this.toolManager.handlePointerDown({ x, y }, mods);
    this.toolManager.handlePointerUp({ x, y }, mods);

    return this.settle();
  }

  /**
   * Click at glyph-local (UPM) coordinates, projecting through the camera.
   * Use when a test asserts exact point positions; plain {@link click} takes
   * screen coordinates, which the viewport y-flips.
   */
  async clickGlyphLocal(
    x: number,
    y: number,
    options?: Partial<typeof DEFAULT_MODIFIERS>,
  ): Promise<this> {
    const screen = this.projectSceneToScreen({ x, y });
    return this.click(screen.x, screen.y, options);
  }

  /**
   * Drags through scene coordinates while preserving drag-start semantics.
   *
   * @param input - Scene-space pointer-down point, threshold-crossing first
   * move, and final pointer position.
   * @returns The scene-space drag points observed through the camera and the
   * delta from `start` to `end`.
   */
  async dragScene(input: {
    down: Point2D;
    start: Point2D;
    end: Point2D;
    options?: Partial<typeof DEFAULT_MODIFIERS>;
  }): Promise<{ down: Point2D; start: Point2D; end: Point2D; delta: Point2D }> {
    const downScreen = this.projectSceneToScreen(input.down);
    const startScreen = this.projectSceneToScreen(input.start);
    const endScreen = this.projectSceneToScreen(input.end);

    this.pointerDown(downScreen.x, downScreen.y, input.options);
    this.pointerMove(startScreen.x, startScreen.y, input.options);
    this.pointerMove(endScreen.x, endScreen.y, input.options);
    this.pointerUp(endScreen.x, endScreen.y, input.options);

    await this.settle();

    const down = this.projectScreenToScene(downScreen);
    const start = this.projectScreenToScene(startScreen);
    const end = this.projectScreenToScene(endScreen);

    return {
      down,
      start,
      end,
      delta: {
        x: end.x - start.x,
        y: end.y - start.y,
      },
    };
  }

  pointerDown(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.toolManager.handlePointerDown({ x, y }, { ...DEFAULT_MODIFIERS, ...options });
    return this;
  }

  pointerMove(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.toolManager.handlePointerMove(
      { x, y },
      { ...DEFAULT_MODIFIERS, ...options },
      { force: true },
    );
    this.toolManager.flushPointerMoves();
    return this;
  }

  pointerUp(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    this.toolManager.handlePointerUp({ x, y }, { ...DEFAULT_MODIFIERS, ...options });
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
