import { describe, expect, it } from "vitest";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("snapping crosses the corners of every contour's box", () => {
  it("returns each contour's bounds corners and any extra box", async () => {
    const { bottom, top } = await editor.draw({
      contours: [
        {
          closed: true,
          points: [
            [100, 0],
            [200, 50],
            [150, 120],
          ],
        },
        {
          points: [
            { x: 300, y: 300, name: "bottom" },
            { x: 300, y: 340, name: "top" },
          ],
        },
      ],
    });
    editor.selectTool("select");
    editor.select([bottom, top]);
    editor.recordCanvas();

    editor.holdDrag(bottom, { x: -98, y: 0 });

    await expect
      .poll(() => editor.drawnSnapCrossings())
      .toEqual([
        // The guide's end on the triangle's point it aligns to.
        { x: 200, y: 50 },
        // The triangle's box corner the guide passes through; no point is there.
        { x: 200, y: 120 },
        // The dragged points, snapped onto the guide, with the selection's box corners on them.
        { x: 200, y: 300 },
        { x: 200, y: 340 },
      ]);
  });
});
