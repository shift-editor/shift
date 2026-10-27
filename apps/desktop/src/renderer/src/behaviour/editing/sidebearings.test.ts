import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";
import type { PointId } from "@shift/types";

let editor: EditorTestSurface;
let start: PointId;
beforeEach(async () => {
  editor = await startTestEditor();
  ({ start } = await editor.draw({
    advance: 500,
    contours: [{ points: [{ x: 100, y: 200, name: "start" }, [150, 200]] }],
  }));
});
afterEach(() => editor.close());

describe("setting the advance and sidebearings from the sidebar", () => {
  it("sets the advance width, and undo restores it", async () => {
    editor.setAdvanceWidth(530);
    await editor.settle();
    expect(await editor.advanceWidth()).toBe(530);

    await editor.undo();
    await editor.settle();
    expect(await editor.advanceWidth()).toBe(500);
  });

  it("sets the right sidebearing by changing the advance", async () => {
    editor.setRightSidebearing(380);
    await editor.settle();

    expect(await editor.advanceWidth()).toBe(150 + 380);
    expect((await editor.drawnGlyph()).sidebearings.rsb).toBe(380);
  });

  it("sets the left sidebearing by moving the outline and keeps the right sidebearing", async () => {
    editor.setLeftSidebearing(120);
    await editor.settle();

    expect(await editor.advanceWidth()).toBe(520);
    expect(await editor.pointPositions([start])).toEqual({ [start]: { x: 120, y: 200 } });
    expect((await editor.drawnGlyph()).sidebearings).toEqual({ lsb: 120, rsb: 350 });
  });

  it("moves anchors and components with the outline when the left sidebearing changes", async () => {
    await editor.addGlyph("B", 66);
    await editor.draw({ anchors: [{ name: "top", x: 40, y: 500 }], components: [{ glyph: "B" }] });

    editor.setLeftSidebearing(120);
    await editor.settle();

    expect(await editor.anchorNamed("top")).toMatchObject({ x: 60, y: 500 });
    expect((await editor.components())[0]?.transformation).toMatchObject({ dx: 20, dy: 0 });
  });

  it("leaves the glyph alone when set to the left sidebearing it already shows", async () => {
    await editor.clickAt({ x: 125, y: 200 }, { metaKey: true });
    const [, control] = (await editor.outline())[0]!.points;
    editor.select([control!.id]);
    await editor.dragPoint(control!.id, { x: -225, y: 0 });
    const shown = (await editor.drawnGlyph()).sidebearings.lsb;
    if (shown === null) throw new Error("Expected a left sidebearing");
    const outline = await editor.outline();
    const advance = await editor.advanceWidth();

    editor.setLeftSidebearing(shown);
    await editor.settle();

    expect(await editor.outline()).toEqual(outline);
    expect(await editor.advanceWidth()).toBe(advance);
  });

  it("restores the outline and advance in one undo step", async () => {
    editor.setLeftSidebearing(120);
    await editor.settle();

    await editor.undo();
    await editor.settle();

    expect(await editor.advanceWidth()).toBe(500);
    expect(await editor.pointPositions([start])).toEqual({ [start]: { x: 100, y: 200 } });
  });
});
