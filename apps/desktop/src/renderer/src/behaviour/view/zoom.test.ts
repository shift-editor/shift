import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bounds, type Point2D } from "@shift/geo";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
});
afterEach(() => editor.close());

function closeTo(actual: Point2D, expected: Point2D): void {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
}

describe("zooming the viewport", () => {
  beforeEach(async () => {
    editor.setViewportSize(1000, 800);
    await editor.draw({
      contours: [
        {
          closed: true,
          points: [
            [100, 100],
            [300, 100],
            [300, 300],
            [100, 300],
          ],
        },
      ],
    });
  });

  it("brings the whole outline into view, closer in, when zooming to fit", async () => {
    const bounds = (await editor.outlineBounds())!;
    editor.zoomTo(0.25);

    editor.zoomToFit();

    expect(editor.zoomLevel()).toBeGreaterThan(0.25);
    for (const corner of [bounds.min, bounds.max]) {
      const shown = editor.screenPosition(corner);
      expect(shown.x).toBeGreaterThanOrEqual(0);
      expect(shown.x).toBeLessThanOrEqual(1000);
      expect(shown.y).toBeGreaterThanOrEqual(0);
      expect(shown.y).toBeLessThanOrEqual(800);
    }
  });

  it("centres the selection when zooming to selection", async () => {
    editor.selectAll();
    const centre = Bounds.center((await editor.outlineBounds())!);
    editor.zoomTo(0.25);

    editor.zoomToSelection();

    closeTo(editor.screenPosition(centre), editor.viewportCentre());
  });

  it("sets an absolute zoom level around the viewport centre", () => {
    const centre = editor.viewportCentre();
    const zoom = editor.zoomLevel();
    const before = editor.screenPosition({ x: 100, y: 100 });

    editor.zoomTo(2);

    expect(editor.zoomLevel()).toBe(2);
    closeTo(editor.screenPosition({ x: 100, y: 100 }), {
      x: centre.x + ((before.x - centre.x) * 2) / zoom,
      y: centre.y + ((before.y - centre.y) * 2) / zoom,
    });
  });
});

describe("opening a glyph frames its metrics box in the viewport", () => {
  const viewport = { width: 800, height: 560 };

  it.each([null, 20, 1200, 5000])(
    "keeps the origin, advance and vertical metrics visible for an outline %s units wide",
    async (width) => {
      editor.setViewportSize(viewport.width, viewport.height);
      const advance = width ?? 500;
      await editor.draw({
        advance,
        contours:
          width === null
            ? []
            : [
                {
                  closed: true,
                  points: [
                    [0, -100],
                    [width, -100],
                    [width, 900],
                    [0, 900],
                  ],
                },
              ],
      });

      editor.frameGlyph();

      const { ascender, descender } = editor.shownLocation().metrics;
      for (const corner of [
        { x: 0, y: ascender },
        { x: advance, y: descender },
      ]) {
        const shown = editor.screenPosition(corner);
        expect(shown.x).toBeGreaterThanOrEqual(0);
        expect(shown.x).toBeLessThanOrEqual(viewport.width);
        expect(shown.y).toBeGreaterThanOrEqual(0);
        expect(shown.y).toBeLessThanOrEqual(viewport.height);
      }
    },
  );
});
