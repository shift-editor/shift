import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
});
afterEach(() => editor.close());

describe("turning a line into a curve", () => {
  it("Command-clicking a line makes it a cubic of the same shape, as one undo step", async () => {
    await editor.draw({
      contours: [
        {
          points: [
            [0, 0],
            [90, 30],
          ],
        },
      ],
    });
    editor.selectTool("select");

    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 45, y: 15 }, { metaKey: true }),
      async (e) => {
        const [contour] = await e.outline();
        expect(contour?.points).toMatchObject([
          { x: 0, y: 0, pointType: "onCurve" },
          { x: 30, y: 10, pointType: "offCurve" },
          { x: 60, y: 20, pointType: "offCurve" },
          { x: 90, y: 30, pointType: "onCurve" },
        ]);
      },
    );
  });
});
