import type { Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";
import { expect, workspaceTest as test } from "./fixtures/electronApp";
import { openCatalogGlyph } from "./fixtures/appLocators";
import { square } from "@/testing/fixtures";
import type { EditorDriver } from "./fixtures/EditorDriver";

interface NavigationGlyphs {
  firstId: GlyphId;
  secondId: GlyphId;
}

// Two empty glyphs, added before each test by the `font` fixture.
test.use({ font: { glyphs: { navigationA: {}, navigationB: {} } } });

/** The two navigation glyphs' ids. */
async function navigationGlyphs(editor: EditorDriver): Promise<NavigationGlyphs> {
  const [first, second] = await Promise.all([
    editor.glyphNamed("navigationA"),
    editor.glyphNamed("navigationB"),
  ]);
  if (!first || !second) throw new Error("Expected the navigation glyphs");
  return { firstId: first.id, secondId: second.id };
}

async function returnHome(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Font overview" }).click();
  await page.waitForURL(/#\/home$/);
}

test("preserves confirmed edits and document history across glyph navigation", async ({
  page,
  editor,
}) => {
  const glyphs = await navigationGlyphs(editor);
  await editor.openGlyph(glyphs.firstId);

  await editor.draw({ contours: [square(100)] });
  expect(await editor.pointCount()).toBe(4);
  await expect
    .poll(() => editor.activeGlyph())
    .toMatchObject({
      glyphId: glyphs.firstId,
      contourCount: 1,
    });

  await returnHome(page);
  await expect.poll(() => editor.activeGlyph()).toBeNull();
  await editor.openGlyph(glyphs.secondId);
  await expect
    .poll(() => editor.activeGlyph())
    .toMatchObject({
      glyphId: glyphs.secondId,
      contourCount: 0,
    });

  await returnHome(page);
  await editor.openGlyph(glyphs.firstId);
  expect(await editor.contourCount()).toBe(1);

  await editor.undo();
  await expect.poll(() => editor.contourCount()).toBe(0);

  await editor.redo();
  await expect.poll(() => editor.contourCount()).toBe(1);
});

test("starts a fresh Pen context after navigating to another glyph", async ({ page, editor }) => {
  const glyphs = await navigationGlyphs(editor);
  await openCatalogGlyph(page, "navigationA", glyphs.firstId);
  await expect.poll(() => editor.activeGlyph()).toMatchObject({ glyphId: glyphs.firstId });
  await page.getByRole("button", { name: "Pen Tool (P)" }).click();
  const bounds = await editor.canvasBounds();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

  await returnHome(page);
  await openCatalogGlyph(page, "navigationB", glyphs.secondId);
  await expect.poll(() => editor.activeGlyph()).toMatchObject({ glyphId: glyphs.secondId });
  const secondBounds = await editor.canvasBounds();
  await page.mouse.click(
    secondBounds.x + secondBounds.width / 2,
    secondBounds.y + secondBounds.height / 2,
  );
  await editor.waitForIdle();

  const pointCount = async (glyph: string) =>
    (await editor.layerOf(glyph)).contours.flatMap((contour) => contour.points).length;
  const pointCounts = {
    first: await pointCount("navigationA"),
    second: await pointCount("navigationB"),
  };
  expect(pointCounts).toEqual({ first: 1, second: 1 });
});

test("clears transient editor state when navigating between glyphs", async ({ page, editor }) => {
  const glyphs = await navigationGlyphs(editor);
  await openCatalogGlyph(page, "navigationA", glyphs.firstId);
  await editor.draw({ contours: [square(100)] });
  await editor.selectVisiblePoint();
  await editor.hoverVisibleUnselectedPoint();

  await returnHome(page);
  await openCatalogGlyph(page, "navigationB", glyphs.secondId);

  await expect
    .poll(async () => {
      const glyph = await editor.activeGlyph();
      return {
        glyphId: glyph?.glyphId,
        selection: await editor.selectionIds(),
        hover: await editor.hoverId(),
        toolState: await editor.toolState(),
      };
    })
    .toEqual({
      glyphId: glyphs.secondId,
      selection: [],
      hover: null,
      toolState: "ready",
    });
  const glyph = await editor.activeGlyph();
  expect(await editor.editedNodeIds()).toEqual([glyph?.nodeId]);

  await returnHome(page);
  await openCatalogGlyph(page, "navigationA", glyphs.firstId);
  await expect
    .poll(() => editor.activeGlyph())
    .toMatchObject({
      glyphId: glyphs.firstId,
      contourCount: 1,
    });
});
