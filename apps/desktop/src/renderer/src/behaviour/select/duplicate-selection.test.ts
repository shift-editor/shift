import { beforeEach, describe, expect, it } from "vitest";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

describe("duplicating the selection", () => {
  it("copies the selected points in place and selects the copy", async () => {
    const { first, second } = await editor.draw(
      {
        contours: [line({ x: 100, y: 100, name: "first" }, { x: 200, y: 100, name: "second" })],
      },
      { select: true },
    );

    expect(await editor.duplicate()).toBe(true);

    const [original, copy] = await editor.outline();
    expect(original?.points.map(({ id }) => id)).toEqual([first, second]);
    expect(copy?.points).toMatchObject([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    expect(editor.selectionIds()).toEqual(copy?.points.map(({ id }) => id));
  });
});
