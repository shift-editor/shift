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

    expect(editor.drawnSnapCrossings()).toEqual([
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 100, y: 120 },
      { x: 200, y: 300 },
      { x: 200, y: 300 },
      { x: 200, y: 340 },
      { x: 200, y: 340 },
      { x: 200, y: 300 },
      { x: 200, y: 300 },
      { x: 200, y: 340 },
      { x: 200, y: 340 },
    ]);
  });
});
