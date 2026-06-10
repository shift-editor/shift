/**
 * TestEditor — a real Editor with a NAPI backend for testing.
 *
 * Usage:
 *   const editor = new TestEditor();
 *   editor.startSession();
 *   editor.selectTool("pen");
 *   editor.click(100, 200);
 *   expect(editor.pointCount).toBe(1);
 */

import type { GlyphHandle } from "@shared/bridge/BridgeApi";
import { Editor } from "@/lib/editor/Editor";
import type { GlyphInstance, GlyphSource } from "@/lib/model/Glyph";
import type { ToolName } from "@/lib/tools/core";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { Font } from "@/lib/model/Font";
import { signal } from "@/lib/signals/signal";
import type { WorkspaceSnapshot } from "@shared/workspace/protocol";
import type { SystemClipboard } from "@/lib/clipboard";
import { MUTATORSANS_DESIGNSPACE } from "./fixtures";
import { testStorePath } from "./workspacePaths";

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

  constructor() {
    const clipboard = new InMemorySystemClipboard();
    super({
      font: new Font(signal<WorkspaceSnapshot | null>(null)),
      clipboard,
    });
    this.#clipboard = clipboard;
    registerBuiltInTools(this);
  }

  get clipboardBuffer(): string {
    return this.#clipboard.buffer;
  }

  get pointCount(): number {
    return this.activeGlyphSource?.allPoints.length ?? 0;
  }

  get currentEdit(): GlyphSource | null {
    return this.activeGlyphSource;
  }

  get currentGlyphInstance(): GlyphInstance | null {
    return this.glyphInstance;
  }

  startSession(handle: GlyphHandle = { name: "A", unicode: 65 }): this {
    if (!this.font.loaded) {
      this.loadFont(MUTATORSANS_DESIGNSPACE, testStorePath("session"));
    }

    const source = this.font.defaultSource;
    const glyphSource = this.openGlyphSource(handle, source.id);
    if (glyphSource) {
      glyphSource.removePoints(glyphSource.allPoints.map((point) => point.id));
    }
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
}
