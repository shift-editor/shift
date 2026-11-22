import { describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { applyDynamicStroke } from "@/lib/commands/strokeCommands";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const ROUND_40 = {
  width: 40,
  cap: "round" as const,
  join: "round" as const,
  miterLimit: 4,
  position: 0,
};

// The stroked-base variant of the Pen-on-instance report (2026-11-23): the
// opened glyph is an instance of a dynamically stroked glyph. See
// penComponentDisappear.test.ts for what this surface can and cannot show.
describe("pen on an instance of a stroked glyph", () => {
  const editor = useTestEditor({
    glyphs: {
      o: { outline: { advance: 600, contours: [rect(-80, -80, 160, 160)] } },
      oref: { outline: { advance: 600, components: [{ glyph: "o", x: 50 }] } },
    },
    open: "oref",
  });

  it("keeps paths visible and shows new points while pen is active", async () => {
    await editor.openGlyph("o");
    const [contour] = await editor.outline();
    editor.select(contour!.points.map((point) => point.id as PointId));
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
    await editor.settle();

    await editor.openGlyph("oref");
    await editor.settle();

    editor.selectTool("pen");
    await editor.clickAt({ x: 300, y: 300 });

    expect(editor.drawnOutline()).toHaveLength(1);
    expect(editor.drawnHandles()).toHaveLength(1);
    expect((await editor.drawnGlyph("oref")).components).toHaveLength(1);
    expect(editor.drawnOutlineIds("oref").componentStrokeFills).not.toBeNull();

    await editor.clickAt({ x: 400, y: 300 });

    expect(editor.drawnOutline()).toHaveLength(1);
    expect(editor.drawnHandles()).toHaveLength(2);
    expect((await editor.drawnGlyph("oref")).components).toHaveLength(1);
  });
});
