<<<<<<< Updated upstream
import { beforeEach, describe, expect, it } from "vitest";
import { ToolEventSimulator, createMockToolContext, type MockToolContext } from "@/testing";
import { TextTool } from ".";

describe("Text tool", () => {
  let text: TextTool;
  let sim: ToolEventSimulator;
  let ctx: MockToolContext;

  beforeEach(() => {
    ctx = createMockToolContext();
    text = new TextTool(ctx);
    sim = new ToolEventSimulator(text);
  });

  it("moves cursor to end when activating with an existing run", () => {
    const buffer = ctx.textRunManager.buffer;
    buffer.insert({ glyphName: "A", unicode: 65 });
    buffer.insert({ glyphName: "B", unicode: 66 });
    buffer.insert({ glyphName: "C", unicode: 67 });
    buffer.moveTo(0);

    sim.setReady();

    expect(buffer.cursorPosition).toBe(buffer.length);
  });

  it("seeds the active glyph and places cursor after it on first activate", () => {
    ctx.textRunManager.clear();
    ctx.setDrawOffset({ x: 120, y: 0 });

    sim.setReady();

    const buffer = ctx.textRunManager.buffer;
    expect(buffer.length).toBe(1);
    expect(buffer.cursorPosition).toBe(1);
  });

  it("restores original editable glyph after escape from initial-glyph flow", () => {
    ctx.textRunManager.clear();
    ctx.setDrawOffset({ x: 120, y: 0 });

    sim.setReady();
    sim.keyDown("b");
    sim.cancel();
    text.deactivate();

    const runState = ctx.textRunManager.state.peek();
    expect(ctx.setActiveTool).toHaveBeenCalledWith("select");
    expect(ctx.getDrawOffset()).toEqual({ x: 120, y: 0 });
    expect(runState?.editingIndex).toBe(0);
    expect(runState?.editingGlyph?.unicode).toBe(65);
  });

  it("restores previous editable slot when leaving text mode directly", () => {
    const buffer = ctx.textRunManager.buffer;
    buffer.insert({ glyphName: "A", unicode: 65 });
    buffer.insert({ glyphName: "B", unicode: 66 });
    ctx.textRunManager.recompute(ctx.font, 40);
    ctx.textRunManager.setEditingSlot(1, { glyphName: "B", unicode: 66 });
    ctx.setDrawOffset({ x: 40, y: 0 });

    sim.setReady();
    text.deactivate();

    const runState = ctx.textRunManager.state.peek();
    expect(ctx.getDrawOffset()).toEqual({ x: 40, y: 0 });
    expect(runState?.editingIndex).toBe(1);
    expect(runState?.editingGlyph?.unicode).toBe(66);
=======
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Text } from "./Text";
import { createMockToolContext, ToolEventSimulator } from "@/testing";
import type { ToolContext } from "../core/ToolContext";

function createCtx() {
  const ctx = createMockToolContext();
  return ctx;
}

describe("Text tool", () => {
  let ctx: ReturnType<typeof createCtx>;
  let text: Text;
  let sim: ToolEventSimulator;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = createCtx();
    text = new Text(ctx as unknown as ToolContext);
    sim = new ToolEventSimulator(text);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("state management", () => {
    it("should start in idle state", () => {
      expect(text.state.type).toBe("idle");
    });

    it("should transition to ready on activate", () => {
      sim.setReady();
      expect(text.state.type).toBe("ready");
    });

    it("should return to idle on deactivate", () => {
      sim.setReady();
      sim.setIdle();
      expect(text.state.type).toBe("idle");
    });

    it("should set preview mode on activate", () => {
      sim.setReady();
      expect(ctx.mocks.render.setPreviewMode).toHaveBeenCalledWith(true);
    });

    it("should not clear text content on deactivate", () => {
      sim.setReady();
      (ctx as any).setTextContent.mockClear();
      sim.setIdle();
      expect((ctx as any).setTextContent).not.toHaveBeenCalledWith(null);
    });
  });

  describe("click to start typing", () => {
    beforeEach(() => {
      sim.setReady();
    });

    it("should transition to typing on click", () => {
      sim.click(100, 100);
      expect(text.state.type).toBe("typing");
    });

    it("should have empty text on initial click", () => {
      sim.click(100, 100);
      if (text.state.type === "typing") {
        expect(text.state.text).toBe("");
        expect(text.state.cursorIndex).toBe(0);
      }
    });
  });

  describe("typing characters", () => {
    beforeEach(() => {
      sim.setReady();
      sim.click(100, 100);
    });

    it("should add character on keyDown", () => {
      sim.keyDown("H");
      if (text.state.type === "typing") {
        expect(text.state.text).toBe("H");
        expect(text.state.cursorIndex).toBe(1);
      }
    });

    it("should add multiple characters", () => {
      sim.keyDown("H");
      sim.keyDown("i");
      if (text.state.type === "typing") {
        expect(text.state.text).toBe("Hi");
        expect(text.state.cursorIndex).toBe(2);
      }
    });

    it("should compute layout for typed text", () => {
      sim.keyDown("A");
      sim.keyDown("B");
      if (text.state.type === "typing") {
        expect(text.state.layout).toHaveLength(2);
        expect(text.state.layout[0].char).toBe("A");
        expect(text.state.layout[1].char).toBe("B");
      }
    });

    it("should not insert when metaKey is held", () => {
      sim.keyDown("a", { metaKey: true });
      if (text.state.type === "typing") {
        expect(text.state.text).toBe("");
      }
    });
  });

  describe("backspace and delete", () => {
    beforeEach(() => {
      sim.setReady();
      sim.click(100, 100);
      sim.keyDown("A");
      sim.keyDown("B");
      sim.keyDown("C");
    });

    it("should delete character before cursor on Backspace", () => {
      sim.keyDown("Backspace");
      if (text.state.type === "typing") {
        expect(text.state.text).toBe("AB");
        expect(text.state.cursorIndex).toBe(2);
      }
    });

    it("should not delete when cursor is at start", () => {
      sim.keyDown("Home");
      const stateBefore = text.state;
      sim.keyDown("Backspace");
      if (text.state.type === "typing" && stateBefore.type === "typing") {
        expect(text.state.text).toBe(stateBefore.text);
      }
    });

    it("should delete character at cursor on Delete", () => {
      sim.keyDown("Home");
      sim.keyDown("Delete");
      if (text.state.type === "typing") {
        expect(text.state.text).toBe("BC");
        expect(text.state.cursorIndex).toBe(0);
      }
    });
  });

  describe("cursor navigation", () => {
    beforeEach(() => {
      sim.setReady();
      sim.click(100, 100);
      sim.keyDown("A");
      sim.keyDown("B");
      sim.keyDown("C");
    });

    it("should move cursor left with ArrowLeft", () => {
      sim.keyDown("ArrowLeft");
      if (text.state.type === "typing") {
        expect(text.state.cursorIndex).toBe(2);
      }
    });

    it("should move cursor right with ArrowRight", () => {
      sim.keyDown("ArrowLeft");
      sim.keyDown("ArrowLeft");
      sim.keyDown("ArrowRight");
      if (text.state.type === "typing") {
        expect(text.state.cursorIndex).toBe(2);
      }
    });

    it("should not move past start", () => {
      sim.keyDown("Home");
      const state1 = text.state;
      sim.keyDown("ArrowLeft");
      if (text.state.type === "typing" && state1.type === "typing") {
        expect(text.state.cursorIndex).toBe(state1.cursorIndex);
      }
    });

    it("should not move past end", () => {
      const state1 = text.state;
      sim.keyDown("ArrowRight");
      if (text.state.type === "typing" && state1.type === "typing") {
        expect(text.state.cursorIndex).toBe(state1.cursorIndex);
      }
    });

    it("should move to start with Home", () => {
      sim.keyDown("Home");
      if (text.state.type === "typing") {
        expect(text.state.cursorIndex).toBe(0);
      }
    });

    it("should move to end with End", () => {
      sim.keyDown("Home");
      sim.keyDown("End");
      if (text.state.type === "typing") {
        expect(text.state.cursorIndex).toBe(3);
      }
    });
  });

  describe("escape", () => {
    it("should return to ready from typing on Escape", () => {
      sim.setReady();
      sim.click(100, 100);
      sim.keyDown("H");
      sim.cancel();
      expect(text.state.type).toBe("ready");
    });

    it("should persist text content on escape (not clear it)", () => {
      sim.setReady();
      sim.click(100, 100);
      sim.keyDown("H");
      (ctx as any).setTextContent.mockClear();
      sim.cancel();
      const calls = (ctx as any).setTextContent.mock.calls;
      for (const call of calls) {
        expect(call[0]).not.toBeNull();
      }
    });
  });

  describe("double-click glyph editing", () => {
    beforeEach(() => {
      sim.setReady();
      sim.click(100, 100);
      (ctx as any).getGlyphAdvance.mockReturnValue(500);
      (ctx as any).getGlyph = vi.fn(() => ({ xAdvance: 0, unicode: 65 }) as any);
      sim.keyDown("H");
      sim.keyDown("O");
    });

    it("should transition to editing-glyph on double-click over a glyph", () => {
      text.handleEvent({ type: "doubleClick", point: { x: 250, y: 400 } });
      expect(text.state.type).toBe("editing-glyph");
    });

    it("should store editing index and unicode", () => {
      text.handleEvent({ type: "doubleClick", point: { x: 250, y: 400 } });
      if (text.state.type === "editing-glyph") {
        expect(text.state.editingIndex).toBe(0);
        expect(text.state.originalUnicode).toBe("H".codePointAt(0));
      }
    });

    it("should call switchEditSession", () => {
      text.handleEvent({ type: "doubleClick", point: { x: 250, y: 400 } });
      expect((ctx as any).switchEditSession).toHaveBeenCalledWith("H".codePointAt(0));
    });

    it("should request temporary select tool", () => {
      text.handleEvent({ type: "doubleClick", point: { x: 250, y: 400 } });
      expect(ctx.tools.requestTemporary).toHaveBeenCalledWith(
        "select",
        expect.objectContaining({ onReturn: expect.any(Function) }),
      );
    });

    it("should not transition if double-click is outside glyphs", () => {
      text.handleEvent({ type: "doubleClick", point: { x: 5000, y: 400 } });
      expect(text.state.type).toBe("typing");
    });
  });

  describe("cursor type", () => {
    it("should return text cursor", () => {
      expect(text.getCursor(text.state)).toEqual({ type: "text" });
    });
  });

  describe("layout computation", () => {
    beforeEach(() => {
      sim.setReady();
      sim.click(100, 100);
      (ctx as any).getGlyphAdvance.mockReturnValue(600);
    });

    it("should use advance width from editor for layout", () => {
      sim.keyDown("X");
      if (text.state.type === "typing") {
        expect(text.state.layout[0].advance).toBe(600);
      }
    });
  });

  describe("text content signal", () => {
    it("should set text content when entering typing state", () => {
      sim.setReady();
      (ctx as any).setTextContent.mockClear();
      sim.click(100, 100);
      expect((ctx as any).setTextContent).toHaveBeenCalled();
    });

    it("should update text content on each keystroke", () => {
      sim.setReady();
      sim.click(100, 100);
      (ctx as any).setTextContent.mockClear();
      sim.keyDown("A");
      expect((ctx as any).setTextContent).toHaveBeenCalled();
    });
  });

  describe("persistence", () => {
    it("should not clear text content on deactivate", () => {
      sim.setReady();
      sim.click(100, 100);
      sim.keyDown("H");
      (ctx as any).setTextContent.mockClear();
      sim.setIdle();
      expect((ctx as any).setTextContent).not.toHaveBeenCalledWith(null);
    });

    it("should restore typing state from existing text content on activate", () => {
      (ctx as any).getTextContent.mockReturnValue({
        text: "Hello",
        layout: [
          { unicode: 72, char: "H", svgPath: null, xOffset: 600, advance: 500 },
          { unicode: 101, char: "e", svgPath: null, xOffset: 1100, advance: 500 },
          { unicode: 108, char: "l", svgPath: null, xOffset: 1600, advance: 500 },
          { unicode: 108, char: "l", svgPath: null, xOffset: 2100, advance: 500 },
          { unicode: 111, char: "o", svgPath: null, xOffset: 2600, advance: 500 },
        ],
        baseGlyphUnicode: 65,
        editingGlyphIndex: null,
        editingXOffset: 0,
      });

      sim.setReady();
      expect(text.state.type).toBe("typing");
      if (text.state.type === "typing") {
        expect(text.state.text).toBe("Hello");
        expect(text.state.cursorIndex).toBe(5);
        expect(text.state.layout).toHaveLength(5);
      }
    });

    it("should go to ready state when no existing text content on activate", () => {
      (ctx as any).getTextContent.mockReturnValue(null);
      sim.setReady();
      expect(text.state.type).toBe("ready");
    });
>>>>>>> Stashed changes
  });
});
