import { beforeEach, describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import type { EditorTestSurface } from "@/testing/surface";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

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

/** Two curves meeting smoothly at 400,100, its handles on the line through 300,0 and 500,200. */
function smoothJunction() {
  return editor.draw({
    contours: [
      {
        points: [
          [100, 100],
          { x: 200, y: 100, off: true },
          { x: 300, y: 0, off: true, name: "incoming" },
          { x: 400, y: 100, smooth: true, name: "junction" },
          { x: 500, y: 200, off: true, name: "outgoing" },
          { x: 600, y: 100, off: true },
          [700, 100],
        ],
      },
    ],
  });
}

describe("Option slides a smooth point along its handles", () => {
  it("drags the point along the handle line and leaves both handles in place", async () => {
    const { incoming, junction, outgoing } = await smoothJunction();

    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 400, y: 100 }, { x: 450, y: 100 }, { altKey: true }),
      (e) =>
        expectNear(
          {
            [junction]: { x: 425, y: 125 },
            [incoming]: { x: 300, y: 0 },
            [outgoing]: { x: 500, y: 200 },
          },
          e,
        ),
    );
  });

  it("moves the whole point and its handles freely without Option", async () => {
    const { junction, outgoing } = await smoothJunction();

    await editor.dragFrom({ x: 400, y: 100 }, { x: 450, y: 100 });

    await expectNear({ [junction]: { x: 450, y: 100 }, [outgoing]: { x: 550, y: 200 } });
  });

  it("drags a handle along its own direction, changing only its length", async () => {
    const { junction, outgoing } = await smoothJunction();

    await editor.dragFrom({ x: 500, y: 200 }, { x: 550, y: 200 }, { altKey: true });

    await expectNear({ [outgoing]: { x: 525, y: 225 }, [junction]: { x: 400, y: 100 } });
  });

  it("nudges a handle along its own direction", async () => {
    const { junction, outgoing } = await smoothJunction();
    editor.select([outgoing]);

    await editor.pressKey("ArrowRight", { altKey: true, shiftKey: true });

    await expectNear({ [outgoing]: { x: 505, y: 205 }, [junction]: { x: 400, y: 100 } });
  });

  it("nudges the point along the handle line without moving the handles", async () => {
    const { incoming, junction, outgoing } = await smoothJunction();
    editor.select([junction]);

    await editor.pressKey("ArrowUp", { altKey: true, shiftKey: true });

    await expectNear({
      [junction]: { x: 405, y: 105 },
      [incoming]: { x: 300, y: 0 },
      [outgoing]: { x: 500, y: 200 },
    });
  });
});

describe("Option on a corner between two lines", () => {
  it("moves the point freely, since no handle gives a direction to slide along", async () => {
    const { corner } = await editor.draw({
      contours: [{ points: [[100, 100], { x: 300, y: 100, name: "corner" }, [500, 300]] }],
    });

    await editor.dragFrom({ x: 300, y: 100 }, { x: 350, y: 140 }, { altKey: true });

    await expectNear({ [corner]: { x: 350, y: 140 } });
    expect(await editor.outline()).toHaveLength(1);
  });
});
