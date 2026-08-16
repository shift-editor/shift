import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("sidebar glyph metrics", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("shape");
    editor.dragScene({
      down: { x: 100, y: 200 },
      start: { x: 110, y: 210 },
      end: { x: 150, y: 250 },
    });
    await editor.settle();
  });

  it("sets advance width through one undoable editor operation", async () => {
    const layer = editor.requireGlyphLayer();
    const initialAdvance = layer.xAdvance;

    editor.setXAdvance(initialAdvance + 40);
    await editor.settle();
    expect(layer.xAdvance).toBe(initialAdvance + 40);

    await editor.undoAndSettle();
    expect(layer.xAdvance).toBe(initialAdvance);
    await editor.redoAndSettle();
    expect(layer.xAdvance).toBe(initialAdvance + 40);
  });

  it("sets right sidebearing without moving the outline", async () => {
    const layer = editor.requireGlyphLayer();
    const initialPositions = layer.allPoints.map(({ x, y }) => ({ x, y }));
    const initialRightSidebearing = layer.sidebearings.rsb;
    if (initialRightSidebearing === null) throw new Error("Expected an outlined glyph");

    editor.setRightSidebearing(initialRightSidebearing + 30);
    await editor.settle();

    expect(layer.sidebearings.rsb).toBe(initialRightSidebearing + 30);
    expect(layer.allPoints.map(({ x, y }) => ({ x, y }))).toEqual(initialPositions);
  });

  it("undoes and redoes right sidebearing as one advance change", async () => {
    const layer = editor.requireGlyphLayer();
    const initialAdvance = layer.xAdvance;
    const initialRightSidebearing = layer.sidebearings.rsb;
    if (initialRightSidebearing === null) throw new Error("Expected an outlined glyph");

    editor.setRightSidebearing(initialRightSidebearing + 30);
    await editor.settle();
    await editor.undoAndSettle();
    expect(layer.xAdvance).toBe(initialAdvance);
    await editor.redoAndSettle();
    expect(layer.sidebearings.rsb).toBe(initialRightSidebearing + 30);
  });

  it("sets left sidebearing by moving the outline and preserving right sidebearing", async () => {
    const layer = editor.requireGlyphLayer();
    const initialAdvance = layer.xAdvance;
    const initialPositions = layer.allPoints.map(({ x, y }) => ({ x, y }));
    const { lsb: initialLeftSidebearing, rsb: initialRightSidebearing } = layer.sidebearings;
    if (initialLeftSidebearing === null) throw new Error("Expected an outlined glyph");

    editor.setLeftSidebearing(initialLeftSidebearing + 25);
    await editor.settle();

    expect(layer.allPoints.map(({ x, y }) => ({ x, y }))).toEqual(
      initialPositions.map(({ x, y }) => ({ x: x + 25, y })),
    );
    expect(layer.xAdvance).toBe(initialAdvance + 25);
    expect(layer.sidebearings.rsb).toBe(initialRightSidebearing);
  });

  it("undoes and redoes left sidebearing as one geometry and advance change", async () => {
    const layer = editor.requireGlyphLayer();
    const initialAdvance = layer.xAdvance;
    const initialPositions = layer.allPoints.map(({ x, y }) => ({ x, y }));
    const initialLeftSidebearing = layer.sidebearings.lsb;
    if (initialLeftSidebearing === null) throw new Error("Expected an outlined glyph");

    editor.setLeftSidebearing(initialLeftSidebearing + 25);
    await editor.settle();
    await editor.undoAndSettle();
    expect(layer.xAdvance).toBe(initialAdvance);
    expect(layer.allPoints.map(({ x, y }) => ({ x, y }))).toEqual(initialPositions);

    await editor.redoAndSettle();
    expect(layer.xAdvance).toBe(initialAdvance + 25);
    expect(layer.sidebearings.lsb).toBe(initialLeftSidebearing + 25);
  });
});
