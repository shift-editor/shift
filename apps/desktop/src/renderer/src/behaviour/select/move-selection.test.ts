import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { cubic, line, type GlyphFixture } from "@/testing/fixtures";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

/** An open diagonal of three points, 100,100 → 150,150 → 200,200. */
const DIAGONAL = {
  contours: [
    {
      points: [
        { x: 100, y: 100, name: "first" },
        { x: 150, y: 150, name: "middle" },
        { x: 200, y: 200, name: "last" },
      ],
    },
  ],
} as const satisfies GlyphFixture;

describe("dragging moves the selection", () => {
  it("moves the whole selection when an unselected segment inside its bounds is dragged", async () => {
    const { first, middle, last } = await editor.draw(DIAGONAL, { select: true });

    await editor.dragFrom({ x: 125, y: 125 }, { x: 160, y: 150 });

    expect(editor.selectionIds()).toEqual([first, middle, last]);
    expect(await editor.point(first)).toMatchObject({ x: 135, y: 125 });
    expect(await editor.point(middle)).toMatchObject({ x: 185, y: 175 });
    expect(await editor.point(last)).toMatchObject({ x: 235, y: 225 });
  });

  it("moves the selection, not an unselected point dragged inside its bounds", async () => {
    const { first, middle, last } = await editor.draw(DIAGONAL);
    editor.select([first, last]);

    await editor.dragFrom({ x: 150, y: 150 }, { x: 190, y: 180 });

    expect(editor.selectionIds()).toEqual([first, last]);
    expect(await editor.point(first)).toMatchObject({ x: 140, y: 130 });
    expect(await editor.point(middle)).toMatchObject({ x: 150, y: 150 });
    expect(await editor.point(last)).toMatchObject({ x: 240, y: 230 });
  });

  it("moves the selection when dragged from inside its bounding box", async () => {
    const { first, last } = await editor.draw(DIAGONAL);
    editor.select([first, last]);

    await editor.dragFrom({ x: 120, y: 180 }, { x: 150, y: 220 });

    expect(await editor.point(first)).toMatchObject({ x: 130, y: 140 });
    expect(await editor.point(last)).toMatchObject({ x: 230, y: 240 });
  });

  it("selects and moves an anchor dragged directly", async () => {
    await editor.draw(DIAGONAL);
    await editor.draw({ anchors: [{ name: "top", x: 300, y: 300 }] });

    await editor.dragFrom({ x: 300, y: 300 }, { x: 330, y: 320 });

    const [anchor] = await editor.anchors();
    expect(editor.selectionIds()).toEqual([anchor?.id]);
    expect(anchor).toMatchObject({ x: 330, y: 320 });
  });

  it("moves selected points and anchors together", async () => {
    const { first, middle } = await editor.draw(DIAGONAL);
    await editor.draw({ anchors: [{ name: "top", x: 300, y: 300 }] });
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 150, y: 150 }, { shiftKey: true });
    await editor.clickAt({ x: 300, y: 300 }, { shiftKey: true });

    await editor.dragFrom({ x: 150, y: 150 }, { x: 180, y: 170 });

    expect(await editor.point(first)).toMatchObject({ x: 130, y: 120 });
    expect(await editor.point(middle)).toMatchObject({ x: 180, y: 170 });
    expect(await editor.anchors()).toMatchObject([{ x: 330, y: 320 }]);
  });

  it("moves each point once when its contour is selected too", async () => {
    const { first, middle, last } = await editor.draw(DIAGONAL);
    await editor.clickAt({ x: 125, y: 125 });
    await editor.clickAt({ x: 125, y: 125 });
    const [contour] = await editor.outline();
    expect(editor.selectionIds()).toEqual([contour?.id, first, middle, last]);

    await editor.dragFrom({ x: 150, y: 150 }, { x: 180, y: 170 });

    expect(await editor.point(first)).toMatchObject({ x: 130, y: 120 });
    expect(await editor.point(middle)).toMatchObject({ x: 180, y: 170 });
    expect(await editor.point(last)).toMatchObject({ x: 230, y: 220 });
  });

  it("drags an unselected point from where the pointer went down, not where the drag began", async () => {
    const { lone } = await editor.draw({
      contours: [{ points: [{ x: 100, y: 200, name: "lone" }] }],
    });

    editor.pressAt({ x: 100, y: 200 });
    editor.movePointerTo({ x: 180, y: 200 });
    editor.movePointerTo({ x: 210, y: 230 });
    await editor.releaseAt({ x: 210, y: 230 });

    expect(editor.selectionIds()).toEqual([lone]);
    expect(await editor.point(lone)).toMatchObject({ x: 210, y: 230 });
  });

  it("moves a curve's handle without its point", async () => {
    const { corner, control } = await editor.draw({
      contours: [
        cubic(
          { x: 100, y: 100, name: "corner" },
          { x: 170, y: 100, name: "control" },
          [220, 20],
          [300, 100],
        ),
      ],
    });

    await editor.dragFrom({ x: 170, y: 100 }, { x: 230, y: 130 });

    expect(await editor.point(corner)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(control)).toMatchObject({ x: 230, y: 130 });
  });

  it("moves a line by both of its points", async () => {
    const { start, end } = await editor.draw({
      contours: [line({ x: 100, y: 200, name: "start" }, { x: 180, y: 200, name: "end" })],
    });

    await editor.dragFrom({ x: 140, y: 200 }, { x: 170, y: 220 });

    expect(await editor.point(start)).toMatchObject({ x: 130, y: 220 });
    expect(await editor.point(end)).toMatchObject({ x: 210, y: 220 });
  });

  it("moves both handles of a dragged smooth point", async () => {
    const { incoming, middle, outgoing } = await editor.draw({
      contours: [
        {
          points: [
            [100, 100],
            { x: 120, y: 120, off: true },
            { x: 140, y: 140, off: true, name: "incoming" },
            { x: 150, y: 150, smooth: true, name: "middle" },
            { x: 160, y: 160, off: true, name: "outgoing" },
            { x: 180, y: 180, off: true },
            [200, 200],
          ],
        },
      ],
    });

    await expectEdit(editor, (e) => e.dragFrom({ x: 150, y: 150 }, { x: 180, y: 170 }), {
      [incoming]: { x: 170, y: 160 },
      [middle]: { x: 180, y: 170 },
      [outgoing]: { x: 190, y: 180 },
    });
  });

  it("does not move anything before the drag threshold is crossed", async () => {
    const { first, last } = await editor.draw(DIAGONAL);
    const nudge = { x: 100 + 2 * editor.pixelSize(), y: 100 };

    editor.pressAt({ x: 100, y: 100 });
    editor.movePointerTo(nudge);
    await editor.releaseAt(nudge);

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(last)).toMatchObject({ x: 200, y: 200 });
  });
});

describe("a drag in flight", () => {
  it("puts every point back when Escape cancels it", async () => {
    const { first, middle, last } = await editor.draw(DIAGONAL);
    const before = await editor.outline();
    editor.select([first, middle, last]);

    editor.holdDrag(middle, { x: 40, y: 30 });
    expect(editor.drawnPoint(middle)).toMatchObject({ x: 190, y: 180 });
    await editor.pressKey("Escape");

    expect(await editor.outline()).toEqual(before);
    expect(editor.drawnPoint(first)).toMatchObject({ x: 100, y: 100 });
    expect(editor.drawnPoint(middle)).toMatchObject({ x: 150, y: 150 });
    expect(editor.drawnPoint(last)).toMatchObject({ x: 200, y: 200 });
  });

  it("previews each sample from where the drag began", async () => {
    const { first } = await editor.draw(DIAGONAL);
    editor.select([first]);

    editor.pressAt({ x: 100, y: 100 });
    editor.movePointerTo({ x: 104, y: 100 });
    editor.movePointerTo({ x: 120, y: 100 });
    const [firstSample] = editor.drawnOutline()[0]!.points;
    editor.movePointerTo({ x: 130, y: 100 });
    expect(editor.drawnOutline()).toMatchObject([
      {
        points: [{ x: expect.closeTo(firstSample!.x + 10) }, expect.anything(), expect.anything()],
      },
    ]);
    await editor.pressKey("Escape");

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
  });

  it("commits the last move even when it is still queued at release", async () => {
    const { lone } = await editor.draw(
      { contours: [{ points: [{ x: 100, y: 200, name: "lone" }] }] },
      { select: true },
    );

    editor.pressAt({ x: 100, y: 200 });
    editor.movePointerTo({ x: 110, y: 200 });
    editor.queuePointerMove({ x: 150, y: 230 });
    await editor.releaseAt({ x: 150, y: 230 });

    expect(await editor.point(lone)).toMatchObject({ x: 150, y: 230 });
  });

  it("commits a drag whose only move crosses the threshold while still queued", async () => {
    const { lone } = await editor.draw(
      { contours: [{ points: [{ x: 100, y: 200, name: "lone" }] }] },
      { select: true },
    );

    editor.pressAt({ x: 100, y: 200 });
    editor.queuePointerMove({ x: 150, y: 230 });
    await editor.releaseAt({ x: 150, y: 230 });

    expect(await editor.point(lone)).toMatchObject({ x: 150, y: 230 });
  });
});

describe("the selection's bounds follow its points", () => {
  it("through a drag and a curve inserted before them", async () => {
    const { first, middle, last } = await editor.draw(DIAGONAL, { select: true });

    await editor.dragFrom({ x: 150, y: 150 }, { x: 180, y: 170 });
    expect(editor.selectionLocalRect()).toMatchObject({ x: 130, y: 120, width: 100, height: 100 });

    await editor.clickAt({ x: 155, y: 145 }, { metaKey: true });
    expect(await editor.outline()).toMatchObject([{ points: Array(5).fill(expect.anything()) }]);
    expect(editor.selectionIds()).toEqual([first, middle, last]);
    expect(editor.selectionLocalRect()).toMatchObject({ x: 130, y: 120, width: 100, height: 100 });
  });
});

describe("dragging while editing several sources", () => {
  it("moves the matching point in every edited source, as one edit", async () => {
    const { middle } = await editor.draw(DIAGONAL);
    await editor.addAxis(WEIGHT);
    await editor.addSource("Bold", { wght: 700 });
    await editor.editSources(["Regular", "Bold"]);
    const bold = { source: { name: "Bold" } };
    const boldBefore = (await editor.point(middle, bold))!;
    editor.select([middle]);

    await expectEdit(editor, (e) => e.dragFrom({ x: 150, y: 150 }, { x: 190, y: 180 }), {
      [middle]: { x: 190, y: 180 },
    });

    expect(await editor.point(middle, bold)).toMatchObject({
      x: boldBefore.x + 40,
      y: boldBefore.y + 30,
    });
    await editor.undo();
    expect(await editor.point(middle, bold)).toEqual(boldBefore);
  });
});
