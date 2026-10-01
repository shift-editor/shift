/**
 * Canvas rendering at a Retina device scale. Stroke widths, handle sizes, and canvas backing
 * stores scale with the device pixel ratio, so the default 1× goldens cannot catch 2× regressions.
 */
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { expectCanvasSnapshot } from "./fixtures/snapshots";

test.use({ deviceScaleFactor: 2 });

test("renders glyph, handles, and selection at 2× device scale", async ({ page, editor }) => {
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
  await editor.openGlyphByUnicode("53");
  await editor.selectAll();
  expect(await editor.selectionIds()).toHaveLength(await editor.pointCount());
  await page.mouse.move(1, 1);

  await expectCanvasSnapshot(editor, "canvas-S-all-selected-2x.png");
});
