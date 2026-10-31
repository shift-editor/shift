import { describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("reversing a contour", () => {
  it("reverses the contour the selected points belong to", async () => {
    const { a, b, c } = await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0, name: "a" },
            { x: 100, y: 0, name: "b" },
            { x: 200, y: 0, name: "c" },
          ],
        },
      ],
    });

    await expectEdit(
      editor,
      async (e) => {
        e.select([a, b]);
        expect(await e.reverseSelectedContour()).toBe(true);
      },
      async (e) => {
        expect(await e.outline()).toMatchObject([
          {
            points: [
              { id: c, x: 200 },
              { id: b, x: 100 },
              { id: a, x: 0 },
            ],
          },
        ]);
      },
    );
  });
});
