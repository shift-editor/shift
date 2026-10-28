import { beforeEach, describe, expect, it } from "vitest";
import { offCurve, onCurve } from "@/testing/outlineMatchers";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("pen");
});

async function drawLine(): Promise<void> {
  await editor.clickAt({ x: 100, y: 100 });
  await editor.clickAt({ x: 300, y: 100 });
}

describe("pulling a handle out of an open end", () => {
  it("starts the next curve from a free handle pulled out of a line's end", async () => {
    await drawLine();

    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });
    await editor.dragFrom({ x: 500, y: 100 }, { x: 540, y: 140 });

    const [contour] = await editor.outline();
    expect(contour?.points.slice(0, 3)).toMatchObject([
      onCurve(100, 100),
      { ...onCurve(300, 100), smooth: false },
      offCurve(380, 180),
    ]);
  });

  it("pulls a handle a few font units long when zoomed in", async () => {
    editor.setZoom(10);
    await drawLine();

    // 2 units at 10× zoom is a 20-pixel drag: a deliberate pull, not a jiggle.
    await editor.dragFrom({ x: 300, y: 100 }, { x: 302, y: 100 });
    await editor.dragFrom({ x: 310, y: 100 }, { x: 312, y: 102 });

    expect((await editor.outline())[0]?.points[2]).toMatchObject(offCurve(302, 100));
  });

  it("ignores a pull that ends within a few pixels of the end when zoomed out", async () => {
    editor.setZoom(0.25);
    await drawLine();

    // Pressed 5 pixels off the end point, then moved to 6 units (1.5 pixels at
    // 0.25× zoom) from it: a jiggle, not a pull.
    await editor.dragFrom({ x: 320, y: 100 }, { x: 306, y: 100 });
    await editor.dragFrom({ x: 500, y: 100 }, { x: 560, y: 160 });

    // No pulled handle, so the next curve's first control sits a third of the way along.
    expect((await editor.outline())[0]?.points[2]).toMatchObject(
      offCurve(300 + (500 - 300) / 3, 100),
    );
  });

  it("keeps a handle pulled with Option on the line's direction, and the end smooth", async () => {
    await drawLine();

    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 160 }, { altKey: true });
    await editor.dragFrom({ x: 500, y: 100 }, { x: 540, y: 140 });

    const [contour] = await editor.outline();
    expect(contour?.points[1]).toMatchObject({ ...onCurve(300, 100), smooth: true });
    expect(contour?.points[2]).toMatchObject(offCurve(380, 100));
  });

  it("mirrors a curve's incoming handle while pulling from its end", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });

    await editor.dragFrom({ x: 300, y: 100 }, { x: 360, y: 60 });
    await editor.dragFrom({ x: 500, y: 100 }, { x: 540, y: 140 });

    const [contour] = await editor.outline();
    expect(contour?.points.slice(2, 5)).toMatchObject([
      offCurve(240, 140),
      { ...onCurve(300, 100), smooth: true },
      offCurve(360, 60),
    ]);
  });

  it("draws a line on a click after pulling a handle", async () => {
    await drawLine();
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });

    await editor.clickAt({ x: 500, y: 100 });

    expect((await editor.outline())[0]?.points).toMatchObject([
      onCurve(100, 100),
      onCurve(300, 100),
      onCurve(500, 100),
    ]);
  });

  it("draws a line on a click after an ordinary curve drag", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });

    await editor.clickAt({ x: 500, y: 100 });

    expect((await editor.outline())[0]?.points).toMatchObject([
      onCurve(100, 100),
      { pointType: "offCurve" },
      { pointType: "offCurve" },
      onCurve(300, 100),
      onCurve(500, 100),
    ]);
  });

  it("puts a curve's incoming handle back when Escape cancels the pull", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });

    editor.holdDragFrom({ x: 300, y: 100 }, { x: 360, y: 60 });
    await editor.pressKey("Escape");

    expect((await editor.outline())[0]?.points[2]).toMatchObject(offCurve(220, 20));
  });

  it("continues another open contour from the end a handle is pulled out of", async () => {
    await drawLine();
    await editor.pressKey("Escape");

    await editor.dragFrom({ x: 100, y: 100 }, { x: 60, y: 160 });
    await editor.dragFrom({ x: 0, y: 300 }, { x: 40, y: 340 });

    const outline = await editor.outline();
    expect(outline).toHaveLength(1);
    expect(outline[0]?.points.slice(0, 3)).toMatchObject([
      onCurve(300, 100),
      onCurve(100, 100),
      offCurve(60, 160),
    ]);
  });
});
