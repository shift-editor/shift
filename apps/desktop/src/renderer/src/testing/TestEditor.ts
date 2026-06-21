/**
 * TestEditor — a real Editor with input simulation for testing.
 *
 * Usage:
 *   const editor = new TestEditor();
 *   editor.selectTool("pen");
 *   editor.click(100, 200);
 *   expect(editor.pointCount).toBe(1);
 *
 * Editing sessions return when glyph mutations flow through workspace
 * change sets; until then the editor surface under test is tool/input state.
 */

import { Editor } from "@/lib/editor/Editor";
import type { Glyph } from "@/lib/model/Glyph";
import type { ToolName } from "@/lib/tools/core";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { mintGlyphId, mintLayerId, type GlyphName, type Unicode } from "@shift/types";
import type { SystemClipboard } from "@/lib/clipboard";
import { createWorkspaceStack, type WorkspaceStack } from "./workspaceStack";

const DEFAULT_MODIFIERS = { shiftKey: false, altKey: false, metaKey: false };

/**
 * In-memory {@link SystemClipboard} for tests. The buffer is directly
 * readable via {@link TestEditor.clipboardBuffer} so tests can assert on
 * what the Editor wrote without needing a round-trip.
 */
class InMemorySystemClipboard implements SystemClipboard {
  buffer = "";
  writeText(text: string): void {
    this.buffer = text;
  }
  readText(): string {
    return this.buffer;
  }
}

export class TestEditor extends Editor {
  readonly #clipboard: InMemorySystemClipboard;
  readonly #stack: WorkspaceStack;

  constructor() {
    const stack = createWorkspaceStack();
    const clipboard = new InMemorySystemClipboard();
    super({ font: stack.font, clipboard });
    this.#stack = stack;
    this.#clipboard = clipboard;
    registerBuiltInTools(this);
  }

  /**
   * Creates a real workspace, a glyph, and opens an editable session on it —
   * the production pipe end to end (intents → NAPI → SQLite → echo → fold).
   */
  async startSession(name = "A", unicode: number | null = 65): Promise<this> {
    await this.#stack.client.create();

    const glyph = await this.#createAndOpenGlyph(name, unicode);
    const record = this.font.recordForName(glyph.handle.name);
    if (!record) throw new Error("created glyph did not appear in the font directory");
    const location = this.font.defaultLocation();
    this.focusGlyph(record.id, location);
    const itemId = this.scene.placeGlyph({
      glyphId: record.id,
      location,
      origin: { x: 0, y: 0 },
    });
    this.scene.setGeometryItems([itemId]);
    return this;
  }

  /**
   * Adds another glyph to the workspace font and pulls its model into the
   * Font cache — the same create-then-open flow EditorView runs in the app.
   */
  async addGlyph(name: string, unicode: number | null): Promise<void> {
    await this.#createAndOpenGlyph(name, unicode);
  }

  async #createAndOpenGlyph(name: string, unicode: number | null): Promise<Glyph> {
    const glyphId = mintGlyphId();
    const applied = await this.#stack.client.apply([
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
          sourceId: this.font.defaultSource.id,
        },
      },
    ]);

    const record = applied.glyphs?.find((glyph) => glyph.name === name);
    if (!record) throw new Error("createGlyph did not echo the new record");

    const glyph = await this.font.openGlyph(record.id, this.font.defaultSource);
    if (!glyph) throw new Error("openGlyph returned null for a created glyph");
    return glyph;
  }

  /** Awaits every queued and in-flight apply; geometry reads confirmed truth after. */
  async settle(): Promise<this> {
    await this.font.editQueue.settled();
    return this;
  }

  /** Undo through the one authority (workspace ledger), settled. */
  async undoAndSettle(): Promise<this> {
    await this.font.editQueue.undo();
    return this;
  }

  /** Redo through the workspace ledger, settled. */
  async redoAndSettle(): Promise<this> {
    await this.font.editQueue.redo();
    return this;
  }

  get clipboardBuffer(): string {
    return this.#clipboard.buffer;
  }

  get pointCount(): number {
    return this.activeGlyphSource?.allPoints.length ?? 0;
  }

  click(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    const mods = { ...DEFAULT_MODIFIERS, ...options };
    this.toolManager.handlePointerDown({ x, y }, mods);
    this.toolManager.handlePointerUp({ x, y });
    return this;
  }

  /**
   * Click at glyph-local (UPM) coordinates, projecting through the camera.
   * Use when a test asserts exact point positions; plain {@link click} takes
   * screen coordinates, which the viewport y-flips.
   */
  clickGlyphLocal(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    const { screen } = this.fromGlyphLocal({ x, y });
    return this.click(screen.x, screen.y, options);
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

  pointerUp(x: number, y: number): this {
    this.toolManager.handlePointerUp({ x, y });
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

  escape(): this {
    return this.keyDown("Escape");
  }

  selectTool(name: ToolName): this {
    this.setActiveTool(name);
    return this;
  }
}
