/**
 * Visual snapshot tests for glyph rendering — covers handles, curves, filled
 * outlines, and distinct visual styles for on-curve vs off-curve points.
 *
 * Uses MutatorSans "S" (U+0053), whose TrueType quadratic contours include
 * smooth/corner nodes and off-curve handles — exercising every visual style.
 *
 * Pen gestures use positions normalized to the interactive canvas and prove the
 * authored point count before each capture, so a layout change cannot silently
 * redraw different geometry.
 */

import type { Point2D } from "@shift/geo";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { expectCanvasSnapshot } from "./fixtures/snapshots";

// MutatorSans glyph codepoints (hex).
const GLYPH_S = "53"; // Complex quadratic curves
const GLYPH_B = "42"; // Mix of curves + straights
const GLYPH_I = "49"; // Simple straight segments
const GLYPH_Q = "51"; // Counter with curves

/** Clicks with the Pen tool and waits until the click authored `added` more points. */
async function penClick(editor: EditorDriver, at: Point2D, added = 1): Promise<void> {
  const before = await editor.pointCount();
  const point = await editor.canvasPagePoint(at);
  await editor.page.mouse.click(point.x, point.y);
  await expect.poll(() => editor.pointCount()).toBe(before + added);
}

/** Presses at `from` and drags to `to` with the active tool, leaving the pointer pressed. */
async function penDragPreview(editor: EditorDriver, from: Point2D, to: Point2D): Promise<void> {
  await editor.pointerDown(await editor.canvasPagePoint(from));
  await editor.pointerMove(await editor.canvasPagePoint(to), 5);
  await expect.poll(() => editor.toolState()).toBe("dragging");
}

/** Click-drags a smooth Pen point and waits until the gesture authored `added` more points. */
async function penDrag(
  editor: EditorDriver,
  from: Point2D,
  to: Point2D,
  added: number,
): Promise<void> {
  const before = await editor.pointCount();
  await penDragPreview(editor, from, to);
  await editor.pointerUp();
  await expect.poll(() => editor.pointCount()).toBe(before + added);
}

test.describe("Glyph rendering — S (quadratic curves)", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode(GLYPH_S);
  });

  test("composited canvas shows full glyph with handles", async ({ editor }) => {
    await expectCanvasSnapshot(editor, "canvas-S-composited.png");
  });

  test("select-all highlights every handle and shows the bounding box", async ({ editor }) => {
    await editor.selectAll();
    expect(await editor.selectionIds()).toHaveLength(await editor.pointCount());

    await expectCanvasSnapshot(editor, "canvas-S-all-selected.png");
  });
});

test.describe("Glyph rendering — zoom", () => {
  test("handles and control lines stay crisp at high zoom", async ({ page, editor }) => {
    await editor.openGlyphByUnicode(GLYPH_S);
    const offCurve = (await editor.outline())[0]?.points.find(
      (point) => point.pointType === "offCurve",
    );
    if (!offCurve) throw new Error("Expected an off-curve point on S");
    const [target] = await editor.pointTargets([offCurve.id]);
    if (!target) throw new Error("Expected off-curve point target");

    // Wheel steps are clamped to ×1.1, so a fixed step count from the fit zoom is
    // deterministic; anchoring on the handle keeps it at the same canvas position.
    const zoom = () => page.evaluate(() => window.shift!.editor.zoom);
    const fitZoom = await zoom();
    const steps = Math.ceil(Math.log(12 / fitZoom) / Math.log(1.1));
    for (let step = 0; step < steps; step++) {
      await editor.canvas.dispatchEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: target.pagePosition.x,
        clientY: target.pagePosition.y,
        ctrlKey: true,
        deltaMode: 0,
        deltaY: -100,
      });
    }
    await expect.poll(zoom).toBeCloseTo(fitZoom * 1.1 ** steps, 6);
    expect(await zoom()).toBeGreaterThanOrEqual(8);
    expect(await zoom()).toBeLessThanOrEqual(16);

    await page.mouse.move(1, 1);
    await expect.poll(() => editor.hoverId()).toBeNull();

    await expectCanvasSnapshot(editor, "canvas-S-high-zoom.png");
  });
});

test.describe("Pen tool drawing — segment snapshots", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode(GLYPH_I);
    await editor.selectTool("pen");
  });

  test("single on-curve point (click)", async ({ editor }) => {
    await penClick(editor, { x: 0.7, y: 0.7 });

    await expectCanvasSnapshot(editor, "pen-single-point.png");
  });

  test("straight line segment (two clicks)", async ({ editor }) => {
    await penClick(editor, { x: 0.55, y: 0.45 });
    await penClick(editor, { x: 0.8, y: 0.8 });

    await expectCanvasSnapshot(editor, "pen-straight-segment.png");
  });

  test("space preview keeps an open contour outline visible", async ({ page, editor }) => {
    await penClick(editor, { x: 0.55, y: 0.45 });
    await penClick(editor, { x: 0.8, y: 0.8 });

    await page.keyboard.down("Space");
    try {
      await expectCanvasSnapshot(editor, "pen-open-contour-space-preview.png");
    } finally {
      await page.keyboard.up("Space");
    }
  });

  test("preview line follows the latest on-curve endpoint after undo", async ({ page, editor }) => {
    const before = await editor.pointCount();
    // Below the I baseline, so no click lands on existing geometry.
    for (const x of [0.1, 0.2, 0.3]) await penClick(editor, { x, y: 0.85 });
    await editor.undo();
    await expect.poll(() => editor.pointCount()).toBe(before + 2);

    const preview = await editor.canvasPagePoint({ x: 0.8, y: 0.35 });
    await page.mouse.move(preview.x, preview.y);
    await editor.flushPointerMoves();

    await expectCanvasSnapshot(editor, "pen-preview-after-undo.png");
  });

  test("cubic curve with handles (click-drag)", async ({ editor }) => {
    await penClick(editor, { x: 0.35, y: 0.7 });
    await penDrag(editor, { x: 0.55, y: 0.45 }, { x: 0.65, y: 0.35 }, 3);

    await expectCanvasSnapshot(editor, "pen-cubic-curve.png");
  });

  test("cubic curve preview before pointer release", async ({ editor }) => {
    await penClick(editor, { x: 0.35, y: 0.7 });
    await penDragPreview(editor, { x: 0.55, y: 0.45 }, { x: 0.65, y: 0.35 });

    try {
      await expectCanvasSnapshot(editor, "pen-cubic-curve-drag-preview.png");
    } finally {
      await editor.pointerUp();
    }
  });

  test("smooth junction preview before consecutive curve release", async ({ editor }) => {
    await penClick(editor, { x: 0.4, y: 0.7 });
    await penDrag(editor, { x: 0.58, y: 0.45 }, { x: 0.68, y: 0.35 }, 3);
    await penDragPreview(editor, { x: 0.78, y: 0.48 }, { x: 0.9, y: 0.38 });

    try {
      await expectCanvasSnapshot(editor, "pen-smooth-junction-drag-preview.png");
    } finally {
      await editor.pointerUp();
    }
  });

  test("multiple segments — mixed straight and cubic", async ({ editor }) => {
    await penClick(editor, { x: 0.4, y: 0.8 });
    await penClick(editor, { x: 0.55, y: 0.6 });
    await penDrag(editor, { x: 0.7, y: 0.45 }, { x: 0.7, y: 0.25 }, 3);
    await penClick(editor, { x: 0.92, y: 0.75 });

    await expectCanvasSnapshot(editor, "pen-mixed-segments.png");
  });

  test("cubic S-curve with symmetric handles", async ({ editor }) => {
    await penClick(editor, { x: 0.4, y: 0.7 });
    await penDrag(editor, { x: 0.58, y: 0.4 }, { x: 0.68, y: 0.3 }, 3);
    await penDrag(editor, { x: 0.82, y: 0.65 }, { x: 0.7, y: 0.75 }, 3);

    await expectCanvasSnapshot(editor, "pen-s-curve-handles.png");
  });
});

test.describe("Segment selection rendering", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode(GLYPH_I);
    await editor.selectTool("pen");
    await penClick(editor, { x: 0.55, y: 0.45 });
    await penClick(editor, { x: 0.8, y: 0.8 });
    await editor.selectTool("select");
  });

  test("selected segment is highlighted, and the highlight hides while translating", async ({
    page,
    editor,
  }) => {
    const middle = { x: 0.675, y: 0.625 };
    const middlePage = await editor.canvasPagePoint(middle);
    await page.mouse.click(middlePage.x, middlePage.y);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift?.editor;
          const [id] = editor?.selection.ids ?? [];
          return id ? editor?.object(id)?.kind : null;
        }),
      )
      .toBe("segment");
    await expectCanvasSnapshot(editor, "segment-selected.png");

    await editor.pointerDown(middlePage);
    await editor.pointerMove(await editor.canvasPagePoint({ x: 0.7, y: 0.66 }), 5);
    try {
      await expect.poll(() => editor.toolState()).toBe("translating");
      await expectCanvasSnapshot(editor, "segment-translating.png");
    } finally {
      await editor.pointerUp();
    }
  });
});

test.describe("Glyph rendering — multiple glyphs", () => {
  test("B glyph — mixed curves and straights", async ({ editor }) => {
    await editor.openGlyphByUnicode(GLYPH_B);
    await expectCanvasSnapshot(editor, "canvas-B-composited.png");
  });

  test("I glyph — straight segments only", async ({ editor }) => {
    await editor.openGlyphByUnicode(GLYPH_I);
    await expectCanvasSnapshot(editor, "canvas-I-composited.png");
  });

  test("Q glyph — counter with curves", async ({ editor }) => {
    await editor.openGlyphByUnicode(GLYPH_Q);
    await expectCanvasSnapshot(editor, "canvas-Q-composited.png");
  });
});
