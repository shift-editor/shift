import { beforeEach, describe, expect, it } from "vitest";
import type { OutlineContour } from "@/testing/reads";
import { expectEdit } from "@/testing/expectEdit";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({
  glyphs: { A: { outline: { contours: [rect(20, 40, 110, 110)] } } },
});
let source: OutlineContour;
beforeEach(async () => {
  [source] = (await editor.outline()) as [OutlineContour];
  editor.selectObjects([source.id]);
});

// Each paste lands 20 right of and 20 below the one before.
/** The square, pasted once. */
const PASTED_ONCE = {
  closed: true,
  points: [
    { x: 40, y: 20, pointType: "onCurve", smooth: false },
    { x: 150, y: 20, pointType: "onCurve", smooth: false },
    { x: 150, y: 130, pointType: "onCurve", smooth: false },
    { x: 40, y: 130, pointType: "onCurve", smooth: false },
  ],
};
/** The square, pasted twice. */
const PASTED_TWICE = {
  closed: true,
  points: [
    { x: 60, y: 0, pointType: "onCurve", smooth: false },
    { x: 170, y: 0, pointType: "onCurve", smooth: false },
    { x: 170, y: 110, pointType: "onCurve", smooth: false },
    { x: 60, y: 110, pointType: "onCurve", smooth: false },
  ],
};
/** The open line from 300,0 to 400,100, pasted once. */
const LINE_PASTED_ONCE = {
  closed: false,
  points: [
    { x: 320, y: -20, pointType: "onCurve", smooth: false },
    { x: 420, y: 80, pointType: "onCurve", smooth: false },
  ],
};

describe("copying and pasting contours", () => {
  it("pastes a copy with new ids, offset, selected, with the Select tool active", async () => {
    expect(await editor.copy()).toBe(true);
    editor.selectTool("shape");

    let selected: readonly string[] = [];
    await expectEdit(
      editor,
      async (e) => {
        expect(await e.paste()).toBe(true);
        selected = e.selectionIds();
      },
      async (e) => {
        const [, pasted] = await e.outline();
        expect(pasted).toMatchObject(PASTED_ONCE);
        expect(pasted?.points.map(({ id }) => id)).not.toEqual(source.points.map(({ id }) => id));
      },
    );

    const [, pasted] = await editor.outline();
    expect(selected).toEqual(pasted?.points.map(({ id }) => id));
    expect(editor.editorView().tool).toEqual({ id: "select", state: "ready" });
  });

  it("pastes several contours as one undo step", async () => {
    await editor.draw({
      contours: [
        {
          points: [
            [300, 0],
            [400, 100],
          ],
        },
      ],
    });
    const [, open] = (await editor.outline()) as [OutlineContour, OutlineContour];
    editor.selectObjects([source.id, open.id]);
    await editor.copy();

    await expectEdit(
      editor,
      (e) => e.paste(),
      async (e) => {
        expect((await e.outline()).slice(2)).toMatchObject([PASTED_ONCE, LINE_PASTED_ONCE]);
      },
    );
  });

  it("offsets each repeated paste further, and undoes them one at a time", async () => {
    await editor.copy();
    await editor.paste();
    const firstPaste = editor.selectionIds();
    await editor.paste();
    const secondPaste = editor.selectionIds();

    const [, first, second] = await editor.outline();
    expect(first).toMatchObject(PASTED_ONCE);
    expect(second).toMatchObject(PASTED_TWICE);

    await editor.undo();
    expect(await editor.outline()).toHaveLength(2);
    expect(editor.selectionIds()).toEqual(firstPaste);

    await editor.redo();
    expect((await editor.outline())[2]).toMatchObject(PASTED_TWICE);
    expect(editor.selectionIds()).toEqual(secondPaste);
  });

  it("undoes a cut and the paste after it as separate steps", async () => {
    expect(await editor.cut()).toBe(true);
    expect(await editor.outline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);

    expect(await editor.paste()).toBe(true);
    const [pasted] = await editor.outline();
    expect(pasted).toMatchObject(PASTED_ONCE);
    const pastedSelection = editor.selectionIds();

    await editor.undo();
    expect(await editor.outline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);
    await editor.undo();
    expect(await editor.outline()).toEqual([source]);
    expect(editor.selectionIds()).toEqual([source.id]);

    await editor.redo();
    expect(await editor.outline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);
    await editor.redo();
    expect((await editor.outline())[0]).toMatchObject(PASTED_ONCE);
    expect(editor.selectionIds()).toEqual(pastedSelection);
  });
});
