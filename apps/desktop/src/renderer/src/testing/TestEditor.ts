/**
 * TestEditor — a real Editor with a mock NAPI backend for testing.
 *
 * Usage:
 *   const editor = new TestEditor();
 *   editor.startSession("A");
 *   editor.selectTool("pen");
 *   editor.click(100, 200);
 *   expect(editor.pointCount).toBe(1);
 */

import type { Point2D, PointId, GlyphSnapshot } from "@shift/types";
import type { Glyph } from "@/lib/model/Glyph";
import { Glyphs } from "@shift/font";
import { Editor } from "@/lib/editor/Editor";
import type { ToolName } from "@/lib/tools/core";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { createBridge } from "./engine";
import type { ClipboardAdapter } from "@/lib/clipboard";

const DEFAULT_MODIFIERS = { shiftKey: false, altKey: false, metaKey: false };

/**
 * In-memory {@link ClipboardAdapter} for tests. The buffer is directly
 * readable via {@link TestEditor.clipboardBuffer} so tests can assert on
 * what the Editor wrote without needing a round-trip.
 */
class FakeClipboardAdapter implements ClipboardAdapter {
  buffer = "";
  writeText(text: string): void {
    this.buffer = text;
  }
  readText(): string {
    return this.buffer;
  }
}

export class TestEditor extends Editor {
  readonly #clipboardAdapter: FakeClipboardAdapter;

  constructor() {
    const clipboardAdapter = new FakeClipboardAdapter();
    super({ bridge: createBridge(), clipboardAdapter });
    this.#clipboardAdapter = clipboardAdapter;
    registerBuiltInTools(this);
  }

  get clipboardBuffer(): string {
    return this.#clipboardAdapter.buffer;
  }

  startSession(glyphName = "A"): this {
    this.open(glyphName);
    return this;
  }

  click(x: number, y: number, options?: Partial<typeof DEFAULT_MODIFIERS>): this {
    const mods = { ...DEFAULT_MODIFIERS, ...options };
    this.toolManager.handlePointerDown({ x, y }, mods);
    this.toolManager.handlePointerUp({ x, y });
    return this;
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

  get snapshot(): GlyphSnapshot | null {
    return this.bridge.getEditingSnapshot();
  }

  get currentGlyph(): Glyph | null {
    return this.glyph.peek();
  }

  get pointCount(): number {
    const glyph = this.currentGlyph;
    if (!glyph) return 0;
    return Glyphs.getAllPoints(glyph).length;
  }

  getPointPosition(pointId: PointId): Point2D | null {
    const glyph = this.currentGlyph;
    if (!glyph) return null;

    const found = Glyphs.findPoint(glyph, pointId);
    if (!found) return null;

    return { x: found.point.x, y: found.point.y };
  }
}
