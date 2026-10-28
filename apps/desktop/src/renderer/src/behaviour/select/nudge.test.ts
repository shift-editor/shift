import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

describe("arrow keys nudge the selected points", () => {
  let first: PointId;
  let second: PointId;

  beforeEach(async () => {
    ({ first, second } = await editor.draw({
      contours: [line({ x: 100, y: 100, name: "first" }, { x: 200, y: 200, name: "second" })],
    }));
    editor.select([first]);
  });

  it.each([
    ["ArrowLeft", { x: 99, y: 100 }],
    ["ArrowRight", { x: 101, y: 100 }],
    ["ArrowUp", { x: 100, y: 101 }],
    ["ArrowDown", { x: 100, y: 99 }],
  ] as const)("moves %s by one unit", async (key, expected) => {
    await editor.pressKey(key);

    expect(await editor.pointPositions([first, second])).toEqual({
      [first]: expected,
      [second]: { x: 200, y: 200 },
    });
  });

  it.each([
    ["the default step", {}, 1],
    ["the Shift step", { shiftKey: true }, 10],
    ["the Cmd step", { metaKey: true }, 100],
  ] as const)("moves by %s", async (_step, modifiers, distance) => {
    await editor.pressKey("ArrowRight", modifiers);

    expect(await editor.pointPositions([first])).toEqual({
      [first]: { x: 100 + distance, y: 100 },
    });
  });

  it("moves every selected point by the same step, as one edit", async () => {
    editor.select([first, second]);

    await expectEdit(editor, (e) => e.pressKey("ArrowUp", { shiftKey: true }), {
      [first]: { x: 100, y: 110 },
      [second]: { x: 200, y: 210 },
    });
  });

  it("changes nothing when no point is selected", async () => {
    editor.select([]);
    const before = await editor.outline();

    await editor.pressKey("ArrowRight");

    expect(await editor.outline()).toEqual(before);
  });

  it("moves selected points and anchors together", async () => {
    await editor.draw({ anchors: [{ name: "top", x: 300, y: 300 }] });
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 300, y: 300 }, { shiftKey: true });

    await editor.pressKey("ArrowUp", { shiftKey: true });

    expect(await editor.pointPositions([first])).toEqual({ [first]: { x: 100, y: 110 } });
    expect(await editor.anchors()).toMatchObject([{ name: "top", x: 300, y: 310 }]);
  });
});

describe("arrow keys nudge a selected component", () => {
  it("moves the component by each step, each nudge one edit", async () => {
    await editor.addGlyph("base", null);
    await editor.openGlyph("base");
    await editor.draw({
      contours: [line([0, 0], [100, 100])],
    });
    await editor.openGlyph("A");
    await editor.draw({ components: [{ glyph: "base" }] });
    await editor.clickAt({ x: 50, y: 50 });

    await editor.pressKey("ArrowRight", { shiftKey: true });
    await editor.pressKey("ArrowUp");
    expect(await editor.components()).toMatchObject([{ transformation: { dx: 10, dy: 1 } }]);

    await editor.undo();
    expect(await editor.components()).toMatchObject([{ transformation: { dx: 10, dy: 0 } }]);
  });
});
