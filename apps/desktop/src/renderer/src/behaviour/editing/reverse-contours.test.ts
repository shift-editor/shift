import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
});
afterEach(() => editor.close());

describe("reversing contours", () => {
  it("reverses the selected contour's point order as one undo step", async () => {
    const { start } = await editor.draw({
      contours: [{ points: [{ x: 0, y: 0, name: "start" }, [100, 0], [200, 0]] }],
    });

    await expectEdit(
      editor,
      async (e) => {
        e.select([start]);
        expect(await e.runCommand("glyph.reverseSelectedContour")).toBe(true);
      },
      async (e) => {
        const [contour] = await e.outline();
        expect(contour?.points.map(({ x }) => x)).toEqual([200, 100, 0]);
      },
    );
  });
});
