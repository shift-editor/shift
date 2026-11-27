import { describe, expect, it } from "vitest";
import type { OutlineStrokeStyle } from "@shift/types";
import { applyDynamicStroke } from "@/lib/commands/strokeCommands";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";
import type { OutlineContour } from "@/testing/reads";

const ROUND_40: OutlineStrokeStyle = {
  width: 40,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};

const editor = useTestEditor({
  glyphs: { A: { outline: { contours: [rect(20, 40, 110, 110)] } } },
});

describe("copying and pasting a stroked contour", () => {
  it("pastes the contour with its dynamic stroke, as one undo step", async () => {
    const [source] = (await editor.outline()) as [OutlineContour];
    editor.selectObjects([source.id]);
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });

    expect(await editor.copy()).toBe(true);
    expect(await editor.paste()).toBe(true);

    const [original, pasted] = (await editor.outline()) as [OutlineContour, OutlineContour];
    const previews = editor.strokeOutlinePreviews();
    const strokedIds = previews.items.map((item) => item.skeletonContourId);
    expect(strokedIds).toEqual(expect.arrayContaining([original.id, pasted.id]));

    // The strokes solve at the copied width: the solved rings are the
    // 110-tall rectangles grown by 40, not the bare skeletons.
    const ys = previews.items
      .flatMap((item) => item.outlines)
      .flatMap((outline) => outline.coordinates.filter((_, index) => index % 2 === 1));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(140);

    await editor.undo();
    expect(await editor.outline()).toHaveLength(1);
    expect(editor.strokeOutlinePreviews().items).toHaveLength(1);
  });

  it("pastes a plain contour without inventing a stroke", async () => {
    const [source] = (await editor.outline()) as [OutlineContour];
    editor.selectObjects([source.id]);

    expect(await editor.copy()).toBe(true);
    expect(await editor.paste()).toBe(true);

    expect(await editor.outline()).toHaveLength(2);
    expect(editor.strokeOutlinePreviews().items).toHaveLength(0);
  });
});
