import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AxisId, SourceId } from "@shift/types";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
let reference: SourceId;
let weight: AxisId;
beforeEach(async () => {
  editor = await startTestEditor();
  reference = editor.editorView().activeSourceId!;
  weight = await editor.addAxis({ tag: "wght", minimum: 100, default: 400, maximum: 900 });
});
afterEach(() => editor.close());

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

    const bold = await editor.addSource("Bold", { [weight]: 700 });

    expect(editor.editorView()).toMatchObject({
      activeSourceId: bold,
      glyph: { sourceId: bold },
    });
    const [copy] = await editor.outline();
    expect(await editor.advanceWidth()).toBe(520);
    expect(copy).toMatchObject({
      closed: original!.closed,
      points: original!.points.map(({ x, y, pointType, smooth }) => ({ x, y, pointType, smooth })),
    });
    expect(copy!.points.map(({ id }) => id)).not.toEqual(original!.points.map(({ id }) => id));
  });
});

describe("choosing sources", () => {
  it("keeps the shown source and the axis location in step", async () => {
    const bold = await editor.addSource("Bold", { [weight]: 700 });

    editor.selectSource(reference);
    expect(editor.editorView().externalLocation).toEqual([{ axisId: weight, value: 400 }]);
    editor.selectSource(bold);
    expect(editor.editorView()).toMatchObject({
      externalLocation: [{ axisId: weight, value: 700 }],
      editingSourceIds: [bold],
    });

    editor.setLocation({ [weight]: 550 });
    expect(editor.editorView()).toMatchObject({ activeSourceId: null, editingSourceIds: [] });

    editor.setLocation({ [weight]: 700 });
    expect(editor.editorView()).toMatchObject({ activeSourceId: bold, editingSourceIds: [bold] });
  });

  it("edits a range or a hand-picked set of sources around the shown one", async () => {
    const thin = await editor.addSource("Thin", { [weight]: 100 });
    const bold = await editor.addSource("Bold", { [weight]: 700 });
    const black = await editor.addSource("Black", { [weight]: 900 });
    const everySource = editor.fontOverview().sources.map(({ id }) => id);

    editor.selectSource(reference);
    editor.selectSourceForEditing(black, "range");
    expect(editor.editorView()).toMatchObject({
      activeSourceId: reference,
      editingSourceIds: everySource,
    });

    editor.selectSource(reference);
    editor.selectSourceForEditing(bold, "toggle");
    editor.selectSourceForEditing(thin, "toggle");
    expect(new Set(editor.editorView().editingSourceIds)).toEqual(new Set([reference, bold, thin]));

    editor.selectSourceForEditing(reference, "toggle");
    expect(new Set(editor.editorView().editingSourceIds)).toEqual(new Set([reference, bold, thin]));
  });

  it("switches editing between every source and the shown one", async () => {
    await editor.addSource("Bold", { [weight]: 700 });
    editor.selectSource(reference);

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
