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

/** A contour's geometry moved by `dx`, `dy`, without its ids. */
function moved(contour: OutlineContour, dx: number, dy: number) {
  return {
    closed: contour.closed,
    points: contour.points.map(({ x, y, pointType, smooth }) => ({
      x: x + dx,
      y: y + dy,
      pointType,
      smooth,
    })),
  };
}

function pointIds(contour: OutlineContour | undefined): string[] {
  return contour?.points.map(({ id }) => id) ?? [];
}

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
        expect(pasted).toMatchObject(moved(source, 20, -20));
        expect(pointIds(pasted)).not.toEqual(pointIds(source));
      },
    );

    const [, pasted] = await editor.outline();
    expect(selected).toEqual(pointIds(pasted));
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
        expect((await e.outline()).slice(2)).toMatchObject([
          moved(source, 20, -20),
          moved(open, 20, -20),
        ]);
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
    expect(first).toMatchObject(moved(source, 20, -20));
    expect(second).toMatchObject(moved(source, 40, -40));

    await editor.undo();
    expect(await editor.outline()).toHaveLength(2);
    expect(editor.selectionIds()).toEqual(firstPaste);

    await editor.redo();
    expect((await editor.outline())[2]).toMatchObject(moved(source, 40, -40));
    expect(editor.selectionIds()).toEqual(secondPaste);
  });

  it("undoes a cut and the paste after it as separate steps", async () => {
    expect(await editor.cut()).toBe(true);
    expect(await editor.outline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);

    expect(await editor.paste()).toBe(true);
    const [pasted] = await editor.outline();
    expect(pasted).toMatchObject(moved(source, 20, -20));
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
    expect((await editor.outline())[0]).toMatchObject(moved(source, 20, -20));
    expect(editor.selectionIds()).toEqual(pastedSelection);
  });
});
