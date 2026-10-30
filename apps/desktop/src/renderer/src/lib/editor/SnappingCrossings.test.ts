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

    editor.holdDrag(bottom, { x: -98, y: 0 });

    await expect
      .poll(() => editor.drawnSnapCrossings())
      .toEqual([
        // The first guide's ends: the triangle's point it aligns to, and the
        // dragged point snapped onto it, where the selection's box corner sits.
        { x: 200, y: 50 },
        { x: 200, y: 300 },
        // The triangle's box corner the guide passes through; no point is there.
        { x: 200, y: 120 },
        // The other dragged point, snapped onto the same line, with the selection's other corner.
        { x: 200, y: 340 },
      ]);
  });
});
