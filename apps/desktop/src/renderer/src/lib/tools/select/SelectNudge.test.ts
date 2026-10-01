import { beforeEach, describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import type { ComponentId, GlyphName, PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("Select arrow keys nudge selected points", () => {
  let editor: TestEditor;
  let firstId: PointId;
  let secondId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [firstId, secondId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    editor.selection.select([firstId]);
    editor.selectTool("select");
  });

  it.each([
    ["ArrowLeft", { x: 99, y: 100 }],
    ["ArrowRight", { x: 101, y: 100 }],
    ["ArrowUp", { x: 100, y: 101 }],
    ["ArrowDown", { x: 100, y: 99 }],
  ] as const)("moves in the %s direction", async (key, expected) => {
    await editor.pressKey(key);

    expect(editor.pointPosition(firstId)).toEqual(expected);
    expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 200 });
  });

  it.each([
    ["the default increment", {}, 1],
    ["the Shift increment", { shiftKey: true }, 10],
    ["the accelerator increment", { metaKey: true }, 100],
  ] as const)("uses %s", async (_description, modifiers, distance) => {
    await editor.pressKey("ArrowRight", modifiers);

    expect(editor.pointPosition(firstId)).toEqual({ x: 100 + distance, y: 100 });
  });

  it("moves every selected point by the same increment", async () => {
    editor.selection.select([firstId, secondId]);

    await editor.pressKey("ArrowUp", { shiftKey: true });

    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 110 });
    expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 210 });
  });

  it("moves selected points and anchors together", async () => {
    const anchorId = editor.requireGlyphLayer().addAnchor("top", { x: 300, y: 300 });
    await editor.settle();
    editor.selection.select([firstId, anchorId]);

    await editor.pressKey("ArrowUp", { shiftKey: true });

    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 110 });
    expect(editor.anchorPosition(anchorId)).toEqual({ x: 300, y: 310 });
  });

  it("commits a nudge as one undoable and redoable edit", async () => {
    editor.selection.select([firstId, secondId]);
    await editor.pressKey("ArrowRight", { shiftKey: true });
    const nudged = [editor.pointPosition(firstId), editor.pointPosition(secondId)];

    await editor.undo();
    expect([editor.pointPosition(firstId), editor.pointPosition(secondId)]).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);

    await editor.redo();
    expect([editor.pointPosition(firstId), editor.pointPosition(secondId)]).toEqual(nudged);
  });
});

describe("Select arrow keys nudge selected components", () => {
  let editor: TestEditor;
  let componentId: ComponentId;

  const translation = () => {
    const component = editor.requireGlyphLayer().components.find(({ id }) => id === componentId);
    return { x: component?.transform.translateX, y: component?.transform.translateY };
  };

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession("root", null);
    await editor.addGlyph("base", null);
    const base = editor.font.recordForName("base" as GlyphName)!;
    const baseLayer = (await editor.font.loadGlyph(base.id)).layerForSource(
      editor.font.defaultSource.id,
    )!;
    const contourId = baseLayer.addContour();
    baseLayer.addPoint(contourId, Point.onCurve({ x: 0, y: 0 }));
    baseLayer.addPoint(contourId, Point.onCurve({ x: 100, y: 100 }));
    componentId = (await editor.addComponent(base.id))!;
    editor.selectTool("select");
  });

  it("moves the component by the increment as one undoable edit", async () => {
    await editor.pressKey("ArrowRight", { shiftKey: true });
    await editor.pressKey("ArrowUp");
    expect(translation()).toEqual({ x: 10, y: 1 });

    await editor.undo();
    expect(translation()).toEqual({ x: 10, y: 0 });
  });
});
