import { beforeEach, describe, expect, it } from "vitest";
import { Bounds } from "@shift/geo";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("zooming the viewport", () => {
  beforeEach(async () => {
    editor.resizeCanvas(1000, 800);
    await editor.draw({ contours: [rect(100, 100, 200, 200)] });
  });

  it("brings the whole outline into view, closer in, when zooming to fit", async () => {
    const bounds = (await editor.outlineBounds())!;
    editor.setZoom(0.25);

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
    editor.setZoom(0.25);

    editor.zoomToSelection();

    expect(editor.screenPosition(centre)).toBeNear(editor.viewportCentre());
  });

  it("sets an absolute zoom level around the viewport centre", () => {
    const centre = editor.viewportCentre();
    const zoom = editor.zoomLevel();
    const before = editor.screenPosition({ x: 100, y: 100 });

    editor.setZoom(2);

    expect(editor.zoomLevel()).toBe(2);
    expect(editor.screenPosition({ x: 100, y: 100 })).toBeNear({
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
      editor.resizeCanvas(viewport.width, viewport.height);
      const advance = width ?? 500;
      await editor.draw({
        advance,
        contours: width === null ? [] : [rect(0, -100, width, 1000)],
      });

      editor.frameGlyph();

      const { ascender, descender } = editor.location().metrics;
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
