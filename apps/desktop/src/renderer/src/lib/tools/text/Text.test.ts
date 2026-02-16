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
  });
});
