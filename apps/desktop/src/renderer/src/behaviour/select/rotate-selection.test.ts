import { beforeEach, describe, expect, it } from "vitest";
import { Vec2, type Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import type { EditorTestSurface } from "@/testing/surface";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

/** How far diagonally outside a selection corner the user presses to rotate, in screen pixels. */
const ROTATE_GRAB_OFFSET_PX = 8;

const editor = useTestEditor();
let first: PointId;
let second: PointId;

beforeEach(async () => {
  ({ first, second } = await editor.draw(
    { contours: [line({ x: 100, y: 100, name: "first" }, { x: 200, y: 200, name: "second" })] },
    { select: true },
  ));
  editor.selectTool("select");
});

/** Where to press just outside the selection's top-right corner to rotate. */
function grabPoint(): Point2D {
  const offset = ROTATE_GRAB_OFFSET_PX * editor.pixelSize();
  return { x: 200 + offset, y: 200 + offset };
}

/** A half turn: from outside the top-right corner across to outside the top-left. */
function halfTurn(e: EditorTestSurface): Promise<void> {
  const offset = ROTATE_GRAB_OFFSET_PX * e.pixelSize();
  return e.dragFrom({ x: 200 + offset, y: 200 + offset }, { x: 100 - offset, y: 200 + offset });
}

async function expectNear(
  expected: Record<PointId, Point2D>,
  from: EditorTestSurface = editor,
): Promise<void> {
  const ids = Object.keys(expected) as PointId[];
  const actual = await from.pointPositions(ids);
  for (const id of ids) {
    expect(actual[id]?.x).toBeCloseTo(expected[id]!.x);
    expect(actual[id]?.y).toBeCloseTo(expected[id]!.y);
  }
}

describe("dragging just outside a selection corner rotates it", () => {
  it("rotates around the selection's centre, as one edit", async () => {
    await expectEdit(editor, halfTurn, (e) =>
      expectNear({ [first]: { x: 200, y: 100 }, [second]: { x: 100, y: 200 } }, e),
    );
  });

  it("rotates from the zone under the pointer-down, not where the drag began", async () => {
    const down = grabPoint();
    const offset = ROTATE_GRAB_OFFSET_PX * editor.pixelSize();

    editor.pressAt(down);
    editor.movePointerTo({ x: down.x + 40, y: down.y + 40 });
    editor.movePointerTo({ x: 100 - offset, y: 200 + offset });
    await editor.releaseAt({ x: 100 - offset, y: 200 + offset });

    await expectNear({ [first]: { x: 200, y: 100 }, [second]: { x: 100, y: 200 } });
  });

  it("snaps to 15° steps on each sample Shift is held", async () => {
    const centre = { x: 150, y: 150 };
    const down = grabPoint();
    const to = Vec2.add(centre, Vec2.rotate(Vec2.sub(down, centre), (20 * Math.PI) / 180));
    const snapped = Vec2.add(
      centre,
      Vec2.rotate(Vec2.sub({ x: 100, y: 100 }, centre), Math.PI / 12),
    );

    editor.pressAt(down);
    editor.movePointerTo(to);
    const free = editor.shownPointPositions([first])[first]!;
    editor.movePointerTo(to, { shiftKey: true });
    expect(editor.shownPointPositions([first])[first]!.x).toBeCloseTo(snapped.x);
    expect(editor.shownPointPositions([first])[first]!.y).toBeCloseTo(snapped.y);
    editor.movePointerTo(to);
    expect(editor.shownPointPositions([first])[first]!.x).toBeCloseTo(free.x);
    expect(editor.shownPointPositions([first])[first]!.y).toBeCloseTo(free.y);
    await editor.pressKey("Escape");
  });

  it("rotates in the glyph's own units when the text is moved on the canvas", async () => {
    editor.moveText({ x: 400, y: 300 });

    await halfTurn(editor);

    await expectNear({ [first]: { x: 200, y: 100 }, [second]: { x: 100, y: 200 } });
  });

  it("puts the points back when Escape cancels the rotation", async () => {
    const down = grabPoint();
    editor.pressAt(down);
    editor.movePointerTo({ x: down.x + 4, y: down.y + 4 });
    editor.movePointerTo({ x: 50, y: 250 });
    expect(editor.shownPointPositions([first])).not.toEqual({ [first]: { x: 100, y: 100 } });
    await editor.pressKey("Escape");

    expect(await editor.pointPositions([first, second])).toEqual({
      [first]: { x: 100, y: 100 },
      [second]: { x: 200, y: 200 },
    });
  });

  it("rotates selected points and anchors alike", async () => {
    await editor.draw({ anchors: [{ name: "mark", x: 125, y: 125 }] });
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 200, y: 200 }, { shiftKey: true });
    await editor.clickAt({ x: 125, y: 125 }, { shiftKey: true });

    await halfTurn(editor);

    const [anchor] = await editor.anchors();
    expect(anchor?.x).toBeCloseTo(175);
    expect(anchor?.y).toBeCloseTo(125);
    await expectNear({ [first]: { x: 200, y: 100 } });
  });
});
