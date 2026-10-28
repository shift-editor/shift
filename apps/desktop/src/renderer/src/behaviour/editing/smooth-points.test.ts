import { describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("making points smooth", () => {
  it("double-clicking a corner makes it smooth, as one undo step", async () => {
    const { corner } = await editor.draw({
      contours: [
        {
          points: [[0, 0], { x: 100, y: 200, name: "corner" }, [200, 0]],
        },
      ],
    });

    await expectEdit(
      editor,
      (e) => e.doubleClickAt({ x: 100, y: 200 }),
      async (e) => {
        expect(await e.point(corner)).toMatchObject({ smooth: true });
      },
    );
  });
});
