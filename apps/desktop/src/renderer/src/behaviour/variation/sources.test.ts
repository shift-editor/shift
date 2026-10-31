import { beforeEach, describe, expect, it } from "vitest";
import type { AxisId, SourceId } from "@shift/types";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const editor = useTestEditor({ axes: [WEIGHT] });
let reference: SourceId;
let weight: AxisId;
beforeEach(() => {
  reference = editor.editorView().activeSourceId!;
  weight = editor.fontOverview().axes[0]!.id;
});

describe("adding a source", () => {
  it("shows the new source with a copy of the open glyph", async () => {
    await editor.draw({
      advance: 520,
      contours: [
        {
          points: [
            [0, 0],
            [100, 0],
            [100, 100],
          ],
        },
      ],
    });
    const [original] = await editor.outline();

    await editor.addSource("Bold", { wght: 700 });
    const bold = editor.source({ name: "Bold" })!.id;

    expect(editor.editorView()).toMatchObject({
      activeSourceId: bold,
      glyph: { sourceId: bold },
    });
    const [copy] = await editor.outline();
    expect(await editor.advanceWidth()).toBe(520);
    expect([copy!]).toDrawLike([original!]);
    expect(copy!.points.map(({ id }) => id)).not.toEqual(original!.points.map(({ id }) => id));
  });
});

describe("choosing sources", () => {
  it("keeps the shown source and the axis location in step", async () => {
    await editor.addSource("Bold", { wght: 700 });
    const bold = editor.source({ name: "Bold" })!.id;

    editor.clickSource("Regular");
    expect(editor.editorView().externalLocation).toEqual([{ axisId: weight, value: 400 }]);
    editor.clickSource("Bold");
    expect(editor.editorView()).toMatchObject({
      externalLocation: [{ axisId: weight, value: 700 }],
      editingSourceIds: [bold],
    });

    editor.setLocation({ wght: 550 });
    expect(editor.editorView()).toMatchObject({ activeSourceId: null, editingSourceIds: [] });

    editor.setLocation({ wght: 700 });
    expect(editor.editorView()).toMatchObject({ activeSourceId: bold, editingSourceIds: [bold] });
  });

  it("edits a range or a hand-picked set of sources around the shown one", async () => {
    await editor.addSource("Thin", { wght: 100 });
    const thin = editor.source({ name: "Thin" })!.id;
    await editor.addSource("Bold", { wght: 700 });
    const bold = editor.source({ name: "Bold" })!.id;
    await editor.addSource("Black", { wght: 900 });
    const everySource = editor.fontOverview().sources.map(({ id }) => id);

    editor.clickSource("Regular");
    editor.clickSource("Black", "range");
    expect(editor.editorView()).toMatchObject({
      activeSourceId: reference,
      editingSourceIds: everySource,
    });

    editor.clickSource("Regular");
    editor.clickSource("Bold", "toggle");
    editor.clickSource("Thin", "toggle");
    expect(new Set(editor.editorView().editingSourceIds)).toEqual(new Set([reference, bold, thin]));

    editor.clickSource("Regular", "toggle");
    expect(new Set(editor.editorView().editingSourceIds)).toEqual(new Set([reference, bold, thin]));
  });

  it("switches editing between every source and the shown one", async () => {
    await editor.addSource("Bold", { wght: 700 });
    editor.clickSource("Regular");

    expect(editor.toggleAllSourcesForEditing()).toBe(true);
    expect(editor.editorView()).toMatchObject({
      activeSourceId: reference,
      editingSourceIds: editor.fontOverview().sources.map(({ id }) => id),
    });

    expect(editor.toggleAllSourcesForEditing()).toBe(true);
    expect(editor.editorView().editingSourceIds).toEqual([reference]);
    expect(editor.collapseEditingSources()).toBe(false);
  });
});
