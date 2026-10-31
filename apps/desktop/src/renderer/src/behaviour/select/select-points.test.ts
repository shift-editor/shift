import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

/** An open line from 100,100 to 200,200. */
const LINE = {
  contours: [line({ x: 100, y: 100, name: "first" }, { x: 200, y: 200, name: "second" })],
};

describe("clicking selects", () => {
  it("selects a point clicked on", async () => {
    const { first } = await editor.draw(LINE);

    await editor.clickAt({ x: 100, y: 100 });

    expect(editor.selectionIds()).toEqual([first]);
  });

  it("clears the selection on a click on empty canvas", async () => {
    await editor.draw(LINE);
    await editor.clickAt({ x: 100, y: 100 });

    await editor.clickAt({ x: 900, y: 900 });

    expect(editor.selectionIds()).toEqual([]);
  });

  it("makes a point smooth on a double-click", async () => {
    const { lone } = await editor.draw({
      contours: [{ points: [{ x: 100, y: 200, name: "lone" }] }],
    });

    await editor.clickAt({ x: 100, y: 200 });
    await editor.clickAt({ x: 100, y: 200 });

    expect(await editor.point(lone)).toMatchObject({ smooth: true });
  });
});

describe("Shift-click adds to and removes from the selection", () => {
  let first: PointId;
  let second: PointId;

  beforeEach(async () => {
    ({ first, second } = await editor.draw(LINE));
  });

  it("adds an unselected point and keeps the rest", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 200, y: 200 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([first, second]);
  });

  it("removes a selected point and keeps the rest", async () => {
    editor.select([first, second]);

    await editor.clickAt({ x: 100, y: 100 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([second]);
  });

  it("keeps the selection on a Shift-click on empty canvas", async () => {
    editor.select([first, second]);

    await editor.clickAt({ x: 900, y: 900 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([first, second]);
  });

  it("adds an unselected segment", async () => {
    await editor.clickAt({ x: 150, y: 150 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([editor.segmentBetween(first, second)]);
  });

  it("removes a selected segment", async () => {
    await editor.dragFrom({ x: 130, y: 170 }, { x: 170, y: 130 });
    expect(editor.selectionIds()).toEqual([editor.segmentBetween(first, second)]);

    await editor.clickAt({ x: 150, y: 150 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([]);
  });

  it("adds an unselected anchor", async () => {
    await editor.draw({ anchors: [{ name: "top", x: 300, y: 300 }] });
    const [anchor] = await editor.anchors();

    await editor.clickAt({ x: 300, y: 300 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([anchor?.id]);
  });

  it("removes a selected anchor", async () => {
    await editor.draw({ anchors: [{ name: "top", x: 300, y: 300 }] });
    const [anchor] = await editor.anchors();
    await editor.clickAt({ x: 300, y: 300 });
    await editor.clickAt({ x: 100, y: 100 }, { shiftKey: true });
    expect(editor.selectionIds()).toEqual([anchor?.id, first]);

    await editor.clickAt({ x: 300, y: 300 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([first]);
  });
});

describe("the cursor offers adding to the selection", () => {
  let first: PointId;
  let second: PointId;

  beforeEach(async () => {
    ({ first, second } = await editor.draw(LINE));
  });

  it("only while Shift is held over an unselected point", async () => {
    await editor.clickAt({ x: 100, y: 100 });

    editor.movePointerTo({ x: 200, y: 200 });
    expect(editor.toolCursor()).not.toBe("add");
    await editor.pressKey("Shift", { shiftKey: true });
    expect(editor.toolCursor()).toBe("add");
    editor.movePointerTo({ x: 200, y: 200 });
    expect(editor.toolCursor()).not.toBe("add");
  });

  it("not with Alt held instead", async () => {
    await editor.clickAt({ x: 100, y: 100 });

    editor.movePointerTo({ x: 200, y: 200 });
    await editor.pressKey("Alt", { altKey: true });

    expect(editor.toolCursor()).toBe("default");
  });

  it("not while nothing is selected", () => {
    editor.movePointerTo({ x: 200, y: 200 }, { shiftKey: true });

    expect(editor.toolCursor()).not.toBe("add");
  });

  it("no longer once Shift-click has added the hovered point", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    editor.movePointerTo({ x: 200, y: 200 }, { shiftKey: true });
    expect(editor.toolCursor()).toBe("add");

    await editor.clickAt({ x: 200, y: 200 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([first, second]);
    expect(editor.toolCursor()).not.toBe("add");
  });

  it("over an unselected segment", () => {
    editor.select([first]);

    editor.movePointerTo({ x: 150, y: 150 }, { shiftKey: true });

    expect(editor.toolCursor()).toBe("add");
  });

  it("not over selected points or empty canvas", () => {
    editor.select([first, second]);

    for (const position of [
      { x: 100, y: 100 },
      { x: 500, y: 500 },
    ]) {
      editor.movePointerTo(position, { shiftKey: true });
      expect(editor.toolCursor()).not.toBe("add");
    }
  });

  it("keeps the move cursor during a Shift drag of a point", async () => {
    editor.select([first]);

    editor.pressAt({ x: 100, y: 100 }, { shiftKey: true });
    editor.movePointerTo({ x: 140, y: 140 }, { shiftKey: true });

    expect(editor.toolCursor()).toBe("move");
    await editor.pressKey("Escape");
  });

  it("shows the move cursor inside the selection's bounding box", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 200, y: 200 }, { shiftKey: true });

    editor.movePointerTo({ x: 120, y: 180 });

    expect(editor.toolCursor()).toBe("move");
  });
});

describe("a marquee selects what it covers", () => {
  /** A horizontal line from 100,200 to 180,200. */
  const FLAT_LINE = {
    contours: [line({ x: 100, y: 200, name: "start" }, { x: 180, y: 200, name: "end" })],
  };

  it("selects points inside it", async () => {
    const { start } = await editor.draw(FLAT_LINE);

    await editor.dragFrom({ x: 80, y: 180 }, { x: 130, y: 230 });

    expect(editor.selectionIds()).toEqual([start]);
  });

  it("finishes when its threshold-crossing move is still queued at release", async () => {
    const { start } = await editor.draw(FLAT_LINE);

    editor.pressAt({ x: 80, y: 180 });
    editor.queuePointerMove({ x: 130, y: 230 });
    await editor.releaseAt({ x: 130, y: 230 });

    expect(editor.selectionIds()).toEqual([start]);
  });

  it("selects a segment it crosses anywhere along its length", async () => {
    const { start, end } = await editor.draw(FLAT_LINE);

    await editor.dragFrom({ x: 130, y: 180 }, { x: 150, y: 220 });

    expect(editor.selectionIds()).toEqual([editor.segmentBetween(start, end)]);
  });

  it("selects a segment with both of its points", async () => {
    const { start, end } = await editor.draw(FLAT_LINE);

    await editor.dragFrom({ x: 80, y: 180 }, { x: 200, y: 220 });

    expect(new Set(editor.selectionIds())).toEqual(
      new Set([start, end, editor.segmentBetween(start, end)]),
    );
  });
});

describe("the bounding box around the selection", () => {
  it.each([
    ["a selected segment with area", [100, 200], [180, 240], { x: 140, y: 220 }, true],
    ["an exactly horizontal segment", [100, 200], [180, 200], { x: 140, y: 200 }, false],
    ["an exactly vertical segment", [100, 100], [100, 200], { x: 100, y: 150 }, false],
    ["a nearly horizontal segment", [100, 200], [180, 205], { x: 140, y: 202.5 }, true],
    ["a nearly vertical segment", [100, 100], [105, 200], { x: 102.5, y: 150 }, true],
  ] as const)("shows for %s: %s", async (_name, start, end, hit, shown) => {
    await editor.draw({ contours: [{ points: [start, end] }] });

    await editor.clickAt(hit);

    expect(editor.boundingBoxShown()).toBe(shown);
  });

  it("shows when both of its sides are small but not zero", async () => {
    await editor.draw({
      contours: [line([100, 100], [112, 112])],
    });

    await editor.dragFrom({ x: 90, y: 90 }, { x: 120, y: 120 });

    expect(editor.boundingBoxShown()).toBe(true);
  });
});
