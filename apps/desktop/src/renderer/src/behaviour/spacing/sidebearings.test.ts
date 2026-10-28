import { describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import { line, rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";

async function spacing(e: EditorTestSurface) {
  const bounds = await e.outlineBounds();
  const advance = await e.advanceWidth();
  return { advance, left: bounds!.min.x, right: advance - bounds!.max.x };
}

async function positions(e: EditorTestSurface): Promise<Point2D[]> {
  return (await e.outline()).flatMap(({ points }) => points.map(({ x, y }) => ({ x, y })));
}

describe("setting the glyph's metrics from the sidebar", () => {
  const editor = useTestEditor({
    glyphs: { A: { outline: { advance: 500, contours: [rect(100, 200, 50, 50)] } } },
  });

  it("sets the advance width as one undoable step", async () => {
    editor.setAdvanceWidth(540);
    await editor.settle();
    expect(await editor.advanceWidth()).toBe(540);

    await editor.undo();
    expect(await editor.advanceWidth()).toBe(500);
    await editor.redo();
    expect(await editor.advanceWidth()).toBe(540);
  });

  it("sets the right sidebearing without moving the outline", async () => {
    const outline = await positions(editor);

    editor.setRightSidebearing(380);
    await editor.settle();

    expect(await spacing(editor)).toEqual({ advance: 530, left: 100, right: 380 });
    expect(await positions(editor)).toEqual(outline);
  });

  it("undoes and redoes the right sidebearing as one advance change", async () => {
    editor.setRightSidebearing(380);
    await editor.settle();

    await editor.undo();
    expect(await spacing(editor)).toEqual({ advance: 500, left: 100, right: 350 });
    await editor.redo();
    expect(await spacing(editor)).toEqual({ advance: 530, left: 100, right: 380 });
  });

  it("sets the left sidebearing by moving the outline and keeping the right sidebearing", async () => {
    const outline = await positions(editor);

    editor.setLeftSidebearing(125);
    await editor.settle();

    expect(await spacing(editor)).toEqual({ advance: 525, left: 125, right: 350 });
    expect(await positions(editor)).toEqual(outline.map(({ x, y }) => ({ x: x + 25, y })));
  });

  it("undoes and redoes the left sidebearing as one outline and advance change", async () => {
    const outline = await positions(editor);
    editor.setLeftSidebearing(125);
    await editor.settle();

    await editor.undo();
    expect(await spacing(editor)).toEqual({ advance: 500, left: 100, right: 350 });
    expect(await positions(editor)).toEqual(outline);
    await editor.redo();
    expect(await spacing(editor)).toEqual({ advance: 525, left: 125, right: 350 });
  });

  it("moves anchors and components with the outline when the left sidebearing changes", async () => {
    await editor.addGlyph("B", 66);
    await editor.draw({ anchors: [{ name: "top", x: 40, y: 500 }], components: [{ glyph: "B" }] });

    editor.setLeftSidebearing(120);
    await editor.settle();

    expect(await editor.anchorNamed("top")).toMatchObject({ x: 60, y: 500 });
    expect((await editor.components())[0]?.transformation).toMatchObject({ dx: 20, dy: 0 });
  });
});

describe("setting a curved glyph's left sidebearing", () => {
  const editor = useTestEditor();

  it("leaves the glyph alone when set to the left sidebearing it already shows", async () => {
    await editor.draw({ advance: 500, contours: [line([100, 200], [150, 200])] });
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
});
