import { beforeEach, describe, expect, it } from "vitest";
import { Vec2, type Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

/** How far diagonally outside a selection corner the user presses to rotate, in screen pixels. */
const ROTATE_GRAB_OFFSET_PX = 8;

const editor = useTestEditor();
let first: PointId;
let second: PointId;
/** Where to press just outside the selection's top-right corner to rotate. */
let grab: Point2D;
/** Where a half turn from {@link grab} ends: as far outside the top-left corner. */
let halfTurnEnd: Point2D;

beforeEach(async () => {
  ({ first, second } = await editor.draw(
    { contours: [line({ x: 100, y: 100, name: "first" }, { x: 200, y: 200, name: "second" })] },
    { select: true },
  ));
  editor.selectTool("select");
  const offset = ROTATE_GRAB_OFFSET_PX * editor.pixelSize();
  grab = { x: 200 + offset, y: 200 + offset };
  halfTurnEnd = { x: 100 - offset, y: 200 + offset };
});

describe("dragging just outside a selection corner rotates it", () => {
  it("rotates around the selection's centre, as one edit", async () => {
    await expectEdit(
      editor,
      (e) => e.dragFrom(grab, halfTurnEnd),
      async (e) => {
        expect(await e.point(first)).toBeNear({ x: 200, y: 100 });
        expect(await e.point(second)).toBeNear({ x: 100, y: 200 });
      },
    );
  });

  it("rotates from the zone under the pointer-down, not where the drag began", async () => {
    editor.pressAt(grab);
    editor.movePointerTo({ x: grab.x + 40, y: grab.y + 40 });
    editor.movePointerTo(halfTurnEnd);
    await editor.releaseAt(halfTurnEnd);

    expect(await editor.point(first)).toBeNear({ x: 200, y: 100 });
    expect(await editor.point(second)).toBeNear({ x: 100, y: 200 });
  });

  it("snaps to 15° steps on each sample Shift is held", async () => {
    const centre = { x: 150, y: 150 };
    const to = Vec2.add(centre, Vec2.rotate(Vec2.sub(grab, centre), (20 * Math.PI) / 180));
    const snapped = Vec2.add(
      centre,
      Vec2.rotate(Vec2.sub({ x: 100, y: 100 }, centre), Math.PI / 12),
    );

    editor.pressAt(grab);
    editor.movePointerTo(to);
    const free = editor.drawnPoint(first);
    editor.movePointerTo(to, { shiftKey: true });
    expect(editor.drawnPoint(first)).toBeNear(snapped);
    editor.movePointerTo(to);
    expect(editor.drawnPoint(first)).toEqual(free);
    await editor.pressKey("Escape");
  });

  it("rotates in the glyph's own units when the text is moved on the canvas", async () => {
    editor.moveText({ x: 400, y: 300 });

    await editor.dragFrom(grab, halfTurnEnd);

    expect(await editor.point(first)).toBeNear({ x: 200, y: 100 });
    expect(await editor.point(second)).toBeNear({ x: 100, y: 200 });
  });

  it("puts the points back when Escape cancels the rotation", async () => {
    editor.pressAt(grab);
    editor.movePointerTo({ x: grab.x + 4, y: grab.y + 4 });
    editor.movePointerTo({ x: 50, y: 250 });
    expect(editor.drawnPoint(first)).not.toMatchObject({ x: 100, y: 100 });
    await editor.pressKey("Escape");

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 200, y: 200 });
  });

  it("rotates selected points and anchors alike", async () => {
    await editor.draw({ anchors: [{ name: "mark", x: 125, y: 125 }] });
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 200, y: 200 }, { shiftKey: true });
    await editor.clickAt({ x: 125, y: 125 }, { shiftKey: true });

    await editor.dragFrom(grab, halfTurnEnd);

    expect(await editor.anchors()).toMatchObject([
      { x: expect.closeTo(175), y: expect.closeTo(125) },
    ]);
    expect(await editor.point(first)).toBeNear({ x: 200, y: 100 });
  });
});
