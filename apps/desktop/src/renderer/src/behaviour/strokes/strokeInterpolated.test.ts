import { describe, expect, it } from "vitest";
import type { OutlineStrokeStyle, PointId } from "@shift/types";
import type { ContourPoints } from "@shift/wasm/protocol";
import { applyDynamicStroke, updateStrokeStyle } from "@/lib/commands/strokeCommands";
import { square } from "@/testing/fixtures";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";

const ROUND_20: OutlineStrokeStyle = {
  width: 20,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};

interface Extent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** The box around every coordinate of `outlines`, controls included. */
function extentOf(outlines: readonly ContourPoints[]): Extent {
  const xs = outlines.flatMap((outline) =>
    outline.coordinates.filter((_, index) => index % 2 === 0),
  );
  const ys = outlines.flatMap((outline) =>
    outline.coordinates.filter((_, index) => index % 2 === 1),
  );

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** What the canvas fills for the open glyph's dynamic strokes in its latest frame. */
function drawn(editor: EditorTestSurface): readonly ContourPoints[] {
  return editor.drawnStrokeFills();
}

async function waitForDrawn(editor: EditorTestSurface): Promise<readonly ContourPoints[]> {
  await expect.poll(() => drawn(editor).length).toBeGreaterThan(0);

  return drawn(editor);
}

/**
 * Strokes the open layer's first contour at `width`. A layer materialised
 * from an already stroked master carries that stroke, so it is widened
 * instead of stroked again.
 */
async function strokeSquare(editor: EditorTestSurface, width: number): Promise<void> {
  const [contour] = await editor.outline();
  editor.select([contour!.points[0]!.id as PointId]);
  const applied = applyDynamicStroke(editor.asEditor(), { ...ROUND_20, width });
  if (!applied.ok) {
    expect(updateStrokeStyle(editor.asEditor(), { width })).toEqual({ ok: true });
  }
  await editor.settle();
}

describe("a dynamic stroke between masters", () => {
  // A is a 100-unit square on Regular (wght 400), advance 300. Bold (wght 700)
  // is the same square with its right edge 100 further right.
  const editor = useTestEditor({
    glyphs: { A: { outline: { advance: 300, contours: [square(100)] } } },
    axes: [WEIGHT],
    sources: { Bold: { wght: 700 } },
  });

  /** Strokes A's square 20 wide on Regular and 60 wide on Bold. */
  async function strokeBothMasters(): Promise<void> {
    editor.clickSource("Regular");
    await editor.openGlyph("A");
    await strokeSquare(editor, 20);

    editor.clickSource("Bold");
    await editor.openGlyph("A");
    const right = [
      await editor.pointAt({ x: 100, y: 0 }),
      await editor.pointAt({ x: 100, y: 100 }),
    ];
    editor.select(right.map((point) => point!.id as PointId));
    await editor.dragPoint(right[0]!.id as PointId, { x: 100, y: 0 });
    await strokeSquare(editor, 60);

    editor.recordCanvas();
  }

  it("draws the stroke solved around the interpolated skeleton, at the interpolated width", async () => {
    await strokeBothMasters();

    // Halfway (wght 550): the skeleton spans 0..150 and the width is 40, so
    // the ink spans -20..170 by -20..120.
    editor.setLocation({ wght: 550 });
    const extent = extentOf(await waitForDrawn(editor));

    expect(extent.minX).toBeCloseTo(-20, 0);
    expect(extent.maxX).toBeCloseTo(170, 0);
    expect(extent.minY).toBeCloseTo(-20, 0);
    expect(extent.maxY).toBeCloseTo(120, 0);
    expect(editor.strokeProblems()).toEqual([]);
  });

  it("draws each master's own stroke at that master", async () => {
    await strokeBothMasters();

    editor.setLocation({ wght: 700 });
    const bold = extentOf(await waitForDrawn(editor));
    expect(bold.minX).toBeCloseTo(-30, 0);
    expect(bold.maxX).toBeCloseTo(230, 0);

    editor.setLocation({ wght: 400 });
    const regular = extentOf(await waitForDrawn(editor));
    expect(regular.minX).toBeCloseTo(-10, 0);
    expect(regular.maxX).toBeCloseTo(110, 0);
  });

  it("keeps drawing between masters while the location moves", async () => {
    await strokeBothMasters();

    // The skeleton's right edge runs 125 / 150 / 175 and the width
    // 30 / 40 / 50, so the ink's right edge runs 140 / 170 / 200.
    for (const [wght, inkRight] of [
      [475, 140],
      [550, 170],
      [625, 200],
    ] as const) {
      editor.setLocation({ wght });
      const extent = extentOf(await waitForDrawn(editor));
      expect(extent.maxX).toBeCloseTo(inkRight, 0);
    }
  });
});

describe("a dynamic stroke stroked on one master only", () => {
  const editor = useTestEditor({
    glyphs: { A: { outline: { advance: 300, contours: [square(100)] } } },
    axes: [WEIGHT],
    sources: { Bold: { wght: 700 } },
  });

  it("draws no stroke between masters, as at the master that does not stroke it", async () => {
    editor.clickSource("Regular");
    await editor.openGlyph("A");
    await strokeSquare(editor, 20);
    editor.recordCanvas();
    await waitForDrawn(editor);

    editor.setLocation({ wght: 550 });
    const framesBefore = editor.canvasFrameCount();
    await expect.poll(() => editor.canvasFrameCount()).toBeGreaterThan(framesBefore);

    expect(drawn(editor)).toEqual([]);
  });
});
