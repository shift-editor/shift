import { beforeEach, describe, expect, it } from "vitest";
import { useTestEditor } from "@/testing/fontFixture";

describe("Pen in a glyph edited inside scaled text", () => {
  const editor = useTestEditor();
  /** The hit distance in glyph units with the text at the font's own size. */
  let fullSizeHitDistance: number;

  beforeEach(() => {
    fullSizeHitDistance = editor.hitDistance();
    editor.setTextSize(editor.metrics().unitsPerEm / 10);
  });

  it("closes the contour on a click within the on-screen radius of its start", async () => {
    editor.selectTool("pen");
    for (const point of [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]) {
      await editor.clickAt(point);
    }
    // Beyond the radius at the font's own size, within it at a tenth of the size.
    const gap = editor.hitDistance() / 2;
    expect(gap).toBeGreaterThan(fullSizeHitDistance);

    await editor.clickAt({ x: 100 + gap, y: 100 + gap });

    const outline = await editor.outline();
    const [contour] = outline;
    expect(outline).toHaveLength(1);
    expect(contour?.closed).toBe(true);
    expect(contour?.points).toHaveLength(3);
  });
});
