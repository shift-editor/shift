import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
let first: PointId;
let second: PointId;

beforeEach(async () => {
  ({ first, second } = await editor.draw(
    { contours: [line({ x: 100, y: 100, name: "first" }, { x: 200, y: 200, name: "second" })] },
    { select: true },
  ));
  editor.selectTool("select");
});

describe("dragging the selection's bounding box resizes it", () => {
  it("changes only x when dragging the right edge, as one edit", async () => {
    await expectEdit(editor, (e) => e.dragFrom({ x: 200, y: 150 }, { x: 250, y: 150 }), {
      [first]: { x: 100, y: 100 },
      [second]: { x: 250, y: 200 },
    });
  });

  it("changes only y when dragging the top edge", async () => {
    await editor.dragFrom({ x: 150, y: 200 }, { x: 150, y: 250 });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 200, y: 250 });
  });

  it("resizes both axes from a corner", async () => {
    await editor.dragFrom({ x: 200, y: 200 }, { x: 250, y: 225 });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 250, y: 225 });
  });

  it("scales both axes alike when Shift is held at a corner", async () => {
    await editor.dragFrom({ x: 200, y: 200 }, { x: 300, y: 250 }, { shiftKey: true });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 300, y: 300 });
  });

  it("flips the shape once the dragged edge crosses the fixed one", async () => {
    await editor.dragFrom({ x: 200, y: 150 }, { x: 50, y: 150 });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 50, y: 200 });
  });

  it("resizes in the glyph's own units when the text is moved on the canvas", async () => {
    editor.moveText({ x: 400, y: 300 });

    await editor.dragFrom({ x: 200, y: 150 }, { x: 250, y: 150 });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 250, y: 200 });
  });

  it("resizes from the handle under the pointer-down, not where the drag began", async () => {
    editor.pressAt({ x: 200, y: 200 });
    editor.movePointerTo({ x: 260, y: 200 });
    editor.movePointerTo({ x: 250, y: 250 });
    await editor.releaseAt({ x: 250, y: 250 });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 250, y: 250 });
  });

  it("puts the points back when Escape cancels the resize", async () => {
    editor.pressAt({ x: 200, y: 200 });
    editor.movePointerTo({ x: 204, y: 204 });
    editor.movePointerTo({ x: 250, y: 250 });
    expect(editor.drawnPoint(first)).toMatchObject({ x: 100, y: 100 });
    expect(editor.drawnPoint(second)).toMatchObject({ x: 250, y: 250 });
    await editor.pressKey("Escape");

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 200, y: 200 });
  });
});

describe.each([false, true])(
  "each resize handle stays under the pointer, Alt held: %s",
  (altKey) => {
    it.each([
      {
        handle: "left",
        down: { x: 100, y: 150 },
        to: { x: 50, y: 150 },
        normal: [
          { x: 50, y: 100 },
          { x: 200, y: 200 },
        ],
        centred: [
          { x: 50, y: 100 },
          { x: 250, y: 200 },
        ],
      },
      {
        handle: "right",
        down: { x: 200, y: 150 },
        to: { x: 250, y: 150 },
        normal: [
          { x: 100, y: 100 },
          { x: 250, y: 200 },
        ],
        centred: [
          { x: 50, y: 100 },
          { x: 250, y: 200 },
        ],
      },
      {
        handle: "top",
        down: { x: 150, y: 200 },
        to: { x: 150, y: 250 },
        normal: [
          { x: 100, y: 100 },
          { x: 200, y: 250 },
        ],
        centred: [
          { x: 100, y: 50 },
          { x: 200, y: 250 },
        ],
      },
      {
        handle: "bottom",
        down: { x: 150, y: 100 },
        to: { x: 150, y: 50 },
        normal: [
          { x: 100, y: 50 },
          { x: 200, y: 200 },
        ],
        centred: [
          { x: 100, y: 50 },
          { x: 200, y: 250 },
        ],
      },
      {
        handle: "top-left",
        down: { x: 100, y: 200 },
        to: { x: 50, y: 250 },
        normal: [
          { x: 50, y: 100 },
          { x: 200, y: 250 },
        ],
        centred: [
          { x: 50, y: 50 },
          { x: 250, y: 250 },
        ],
      },
      {
        handle: "top-right",
        down: { x: 200, y: 200 },
        to: { x: 250, y: 250 },
        normal: [
          { x: 100, y: 100 },
          { x: 250, y: 250 },
        ],
        centred: [
          { x: 50, y: 50 },
          { x: 250, y: 250 },
        ],
      },
      {
        handle: "bottom-left",
        down: { x: 100, y: 100 },
        to: { x: 50, y: 50 },
        normal: [
          { x: 50, y: 50 },
          { x: 200, y: 200 },
        ],
        centred: [
          { x: 50, y: 50 },
          { x: 250, y: 250 },
        ],
      },
      {
        handle: "bottom-right",
        down: { x: 200, y: 100 },
        to: { x: 250, y: 50 },
        normal: [
          { x: 100, y: 50 },
          { x: 250, y: 200 },
        ],
        centred: [
          { x: 50, y: 50 },
          { x: 250, y: 250 },
        ],
      },
    ] as const)(
      "keeps the $handle handle under the pointer",
      async ({ down, to, normal, centred }) => {
        const [firstAt, secondAt] = altKey ? centred : normal;

        await editor.dragFrom(down, to, { altKey });

        expect(await editor.point(first)).toMatchObject(firstAt);
        expect(await editor.point(second)).toMatchObject(secondAt);
      },
    );
  },
);

describe("resize modifiers follow each drag sample", () => {
  it.each([true, false])("switches Alt to %s from the shape as it was", async (altKey) => {
    editor.pressAt({ x: 200, y: 150 }, { altKey: !altKey });
    editor.movePointerTo({ x: 225, y: 150 }, { altKey: !altKey });
    editor.movePointerTo({ x: 250, y: 150 }, { altKey });
    expect(editor.drawnPoint(first)).toMatchObject({ x: altKey ? 50 : 100, y: 100 });
    expect(editor.drawnPoint(second)).toMatchObject({ x: 250, y: 200 });
    await editor.pressKey("Escape");

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 200, y: 200 });
  });

  it.each([true, false])(
    "commits at the release point with the last sample's Alt, %s",
    async (altKey) => {
      editor.pressAt({ x: 200, y: 150 }, { altKey: !altKey });
      editor.movePointerTo({ x: 240, y: 150 }, { altKey });
      await editor.releaseAt({ x: 250, y: 150 }, { altKey: !altKey });

      expect(await editor.point(first)).toMatchObject({ x: altKey ? 50 : 100, y: 100 });
      expect(await editor.point(second)).toMatchObject({ x: 250, y: 200 });
    },
  );

  it("switches on Alt during a Shift resize and commits one edit", async () => {
    await expectEdit(
      editor,
      async (e) => {
        e.pressAt({ x: 200, y: 200 });
        e.movePointerTo({ x: 210, y: 205 }, { shiftKey: true });
        e.movePointerTo({ x: 250, y: 225 }, { altKey: true, shiftKey: true });
        await e.releaseAt({ x: 250, y: 225 });
      },
      { [first]: { x: 50, y: 50 }, [second]: { x: 250, y: 250 } },
    );
  });

  it("switches its pivot in the glyph's own units when the text is moved on the canvas", async () => {
    editor.moveText({ x: 400, y: 300 });

    editor.pressAt({ x: 200, y: 150 });
    editor.movePointerTo({ x: 225, y: 150 });
    editor.movePointerTo({ x: 250, y: 150 }, { altKey: true });
    await editor.releaseAt({ x: 250, y: 150 });

    expect(await editor.point(first)).toMatchObject({ x: 50, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 250, y: 200 });
  });
});

describe("Alt resizes from the centre", () => {
  it("does not halve the shape on its first sample, and Escape puts it back", async () => {
    editor.pressAt({ x: 200, y: 150 }, { altKey: true });
    editor.movePointerTo({ x: 210, y: 150 }, { altKey: true });
    expect(editor.drawnPoint(first)).toMatchObject({ x: 90, y: 100 });
    expect(editor.drawnPoint(second)).toMatchObject({ x: 210, y: 200 });
    await editor.pressKey("Escape");

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 200, y: 200 });
  });

  it("combines with Shift as one edit", async () => {
    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 200, y: 200 }, { x: 250, y: 225 }, { altKey: true, shiftKey: true }),
      { [first]: { x: 50, y: 50 }, [second]: { x: 250, y: 250 } },
    );
  });
});

describe("Shift-constrained resizes commit what they show", () => {
  it.each([true, false])("commits the preview with Shift held at release: %s", async (shiftKey) => {
    editor.pressAt({ x: 200, y: 200 }, { shiftKey: true });
    editor.movePointerTo({ x: 250, y: 225 }, { shiftKey: true });
    expect(editor.toolState()).toMatchObject({ state: "resizing" });
    expect(editor.drawnPoint(first)).toMatchObject({ x: 100, y: 100 });
    expect(editor.drawnPoint(second)).toMatchObject({ x: 250, y: 250 });
    await editor.releaseAt({ x: 250, y: 225 }, { shiftKey });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 250, y: 250 });
  });

  it("commits at the release point with the last sample's constraint, as one edit", async () => {
    await expectEdit(
      editor,
      async (e) => {
        e.pressAt({ x: 200, y: 200 });
        e.movePointerTo({ x: 250, y: 225 }, { shiftKey: true });
        await e.releaseAt({ x: 275, y: 230 });
      },
      { [first]: { x: 100, y: 100 }, [second]: { x: 275, y: 275 } },
    );
  });

  it("drops the constraint when the drag goes on without Shift", async () => {
    editor.pressAt({ x: 200, y: 200 });
    editor.movePointerTo({ x: 250, y: 225 }, { shiftKey: true });
    editor.movePointerTo({ x: 275, y: 230 });
    await editor.releaseAt({ x: 275, y: 230 }, { shiftKey: true });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 275, y: 230 });
  });

  it("takes Shift from a move still queued at release", async () => {
    editor.pressAt({ x: 200, y: 200 });
    editor.queuePointerMove({ x: 250, y: 225 }, { shiftKey: true });
    await editor.releaseAt({ x: 250, y: 225 });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(second)).toMatchObject({ x: 250, y: 250 });
  });
});

describe.each([false, true])("resize cursors follow the flipped shape, Alt held: %s", (altKey) => {
  it.each([
    {
      corner: "top-left",
      down: { x: 100, y: 200 },
      normal: { x: 75, y: 225 },
      acrossX: { x: 250, y: 225 },
      acrossY: { x: 75, y: 50 },
      acrossBoth: { x: 250, y: 50 },
      cursor: "nwse-resize",
      flipped: "nesw-resize",
    },
    {
      corner: "top-right",
      down: { x: 200, y: 200 },
      normal: { x: 225, y: 225 },
      acrossX: { x: 50, y: 225 },
      acrossY: { x: 225, y: 50 },
      acrossBoth: { x: 50, y: 50 },
      cursor: "nesw-resize",
      flipped: "nwse-resize",
    },
    {
      corner: "bottom-left",
      down: { x: 100, y: 100 },
      normal: { x: 75, y: 75 },
      acrossX: { x: 250, y: 75 },
      acrossY: { x: 75, y: 250 },
      acrossBoth: { x: 250, y: 250 },
      cursor: "nesw-resize",
      flipped: "nwse-resize",
    },
    {
      corner: "bottom-right",
      down: { x: 200, y: 100 },
      normal: { x: 225, y: 75 },
      acrossX: { x: 50, y: 75 },
      acrossY: { x: 225, y: 250 },
      acrossBoth: { x: 50, y: 250 },
      cursor: "nwse-resize",
      flipped: "nesw-resize",
    },
  ] as const)(
    "updates the $corner cursor when crossing either pivot axis and back",
    async ({ down, normal, acrossX, acrossY, acrossBoth, cursor, flipped }) => {
      editor.pressAt(down, { altKey });
      editor.movePointerTo(normal, { altKey });
      const shownFirst = editor.drawnPoint(first);
      const shownSecond = editor.drawnPoint(second);

      for (const sample of [
        { at: normal, cursor },
        { at: acrossX, cursor: flipped },
        { at: acrossBoth, cursor },
        { at: acrossY, cursor: flipped },
        { at: normal, cursor },
      ]) {
        editor.movePointerTo(sample.at, { altKey });
        expect(editor.toolCursor()).toBe(sample.cursor);
      }
      expect(editor.drawnPoint(first)).toEqual(shownFirst);
      expect(editor.drawnPoint(second)).toEqual(shownSecond);
      await editor.pressKey("Escape");
    },
  );

  it.each([
    { edge: "left", down: { x: 100, y: 150 }, to: { x: 250, y: 150 }, cursor: "ew-resize" },
    { edge: "right", down: { x: 200, y: 150 }, to: { x: 50, y: 150 }, cursor: "ew-resize" },
    { edge: "top", down: { x: 150, y: 200 }, to: { x: 150, y: 50 }, cursor: "ns-resize" },
    { edge: "bottom", down: { x: 150, y: 100 }, to: { x: 150, y: 250 }, cursor: "ns-resize" },
  ] as const)("keeps the $edge cursor on its axis after flipping", async ({ down, to, cursor }) => {
    editor.pressAt(down, { altKey });
    editor.movePointerTo(to, { altKey });

    expect(editor.toolCursor()).toBe(cursor);
    await editor.pressKey("Escape");
  });

  it("restores the original diagonal at zero scale and starts the next drag unflipped", async () => {
    editor.pressAt({ x: 200, y: 200 }, { altKey });
    editor.movePointerTo({ x: 50, y: 200 }, { altKey });
    expect(editor.toolCursor()).toBe("nwse-resize");
    editor.movePointerTo({ x: altKey ? 150 : 100, y: 200 }, { altKey });
    expect(editor.toolCursor()).toBe("nesw-resize");
    await editor.pressKey("Escape");

    editor.pressAt({ x: 200, y: 200 });
    editor.movePointerTo({ x: 225, y: 225 });
    expect(editor.toolCursor()).toBe("nesw-resize");
    await editor.pressKey("Escape");
  });
});
