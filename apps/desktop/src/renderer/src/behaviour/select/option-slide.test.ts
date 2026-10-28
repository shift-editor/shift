import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { GlyphFixture } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";
import { near } from "@/testing/outlineMatchers";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

/** Two curves meeting smoothly at 400,100, its handles on the line through 300,0 and 500,200. */
const SMOOTH_JUNCTION = {
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
} as const satisfies GlyphFixture;

describe("Option slides a smooth point along its handles", () => {
  it("drags the point along the handle line and leaves both handles in place", async () => {
    const { incoming, junction, outgoing } = await editor.draw(SMOOTH_JUNCTION);

    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 400, y: 100 }, { x: 450, y: 100 }, { altKey: true }),
      async (e) =>
        expect(await e.pointPositions([junction, incoming, outgoing])).toEqual({
          [junction]: near({ x: 425, y: 125 }),
          [incoming]: near({ x: 300, y: 0 }),
          [outgoing]: near({ x: 500, y: 200 }),
        }),
    );
  });

  it("moves the whole point and its handles freely without Option", async () => {
    const { junction, outgoing } = await editor.draw(SMOOTH_JUNCTION);

    await editor.dragFrom({ x: 400, y: 100 }, { x: 450, y: 100 });

    expect(await editor.pointPositions([junction, outgoing])).toEqual({
      [junction]: near({ x: 450, y: 100 }),
      [outgoing]: near({ x: 550, y: 200 }),
    });
  });

  it("drags a handle along its own direction, changing only its length", async () => {
    const { junction, outgoing } = await editor.draw(SMOOTH_JUNCTION);

    await editor.dragFrom({ x: 500, y: 200 }, { x: 550, y: 200 }, { altKey: true });

    expect(await editor.pointPositions([outgoing, junction])).toEqual({
      [outgoing]: near({ x: 525, y: 225 }),
      [junction]: near({ x: 400, y: 100 }),
    });
  });

  it("nudges a handle along its own direction", async () => {
    const { junction, outgoing } = await editor.draw(SMOOTH_JUNCTION);
    editor.select([outgoing]);

    await editor.pressKey("ArrowRight", { altKey: true, shiftKey: true });

    expect(await editor.pointPositions([outgoing, junction])).toEqual({
      [outgoing]: near({ x: 505, y: 205 }),
      [junction]: near({ x: 400, y: 100 }),
    });
  });

  it("nudges the point along the handle line without moving the handles", async () => {
    const { incoming, junction, outgoing } = await editor.draw(SMOOTH_JUNCTION);
    editor.select([junction]);

    await editor.pressKey("ArrowUp", { altKey: true, shiftKey: true });

    expect(await editor.pointPositions([junction, incoming, outgoing])).toEqual({
      [junction]: near({ x: 405, y: 105 }),
      [incoming]: near({ x: 300, y: 0 }),
      [outgoing]: near({ x: 500, y: 200 }),
    });
  });
});

describe("Option on a corner between two lines", () => {
  it("moves the point freely, since no handle gives a direction to slide along", async () => {
    const { corner } = await editor.draw({
      contours: [{ points: [[100, 100], { x: 300, y: 100, name: "corner" }, [500, 300]] }],
    });

    await editor.dragFrom({ x: 300, y: 100 }, { x: 350, y: 140 }, { altKey: true });

    expect(await editor.pointPositions([corner])).toEqual({ [corner]: near({ x: 350, y: 140 }) });
    expect(await editor.outline()).toHaveLength(1);
  });
});
