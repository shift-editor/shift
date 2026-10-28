import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
let first: PointId;
let middle: PointId;
/** The hit distance in glyph units with the text at the font's own size. */
let fullSizeHitDistance: number;

beforeEach(async () => {
  ({ first, middle } = await editor.draw({
    contours: [
      {
        points: [{ x: 100, y: 100, name: "first" }, { x: 300, y: 300, name: "middle" }, [500, 100]],
      },
    ],
  }));
  editor.selectTool("select");
  fullSizeHitDistance = editor.hitDistance();
  editor.setTextSize(editor.metrics().unitsPerEm / 10);
});

describe("a glyph edited in text a tenth of the font's size", () => {
  it("hits a point within the on-screen distance, measured in the glyph's own units", async () => {
    const distance = editor.hitDistance();
    expect(distance).toBeCloseTo(fullSizeHitDistance * 10);

    await editor.clickAt({ x: 300 + distance / 2, y: 300 });

    expect(editor.selectionIds()).toEqual([middle]);
  });

  it("snaps a dragged point to a metric within the on-screen distance", async () => {
    const xHeight = editor.metrics().xHeight;
    if (xHeight === undefined) throw new Error("Expected the test font to author an x-height");
    const near = xHeight - editor.hitDistance() / 2;
    expect(xHeight - near).toBeGreaterThan(fullSizeHitDistance);

    await editor.dragFrom({ x: 300, y: 300 }, { x: 300, y: near });

    expect(await editor.pointPositions([middle])).toEqual({ [middle]: { x: 300, y: xHeight } });
  });

  it("closes a contour when its end drops within the on-screen distance of its start", async () => {
    const gap = editor.hitDistance() / 2;
    expect(gap).toBeGreaterThan(fullSizeHitDistance);

    await editor.dragFrom({ x: 500, y: 100 }, { x: 100 + gap, y: 100 + gap });

    expect(await editor.outline()).toMatchObject([
      { closed: true, points: [{ id: first }, { id: middle }] },
    ]);
  });
});
