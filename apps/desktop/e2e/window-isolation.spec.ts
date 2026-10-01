import { documentTest as test, expect } from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";
import { createAnotherDirtyFont, dirtyNewFont, glyphIdForName } from "./fixtures/documentLifecycle";
import { EditorDriver } from "./fixtures/EditorDriver";
import { addSquare } from "./fixtures/editorInteractions";

test("keeps authored document state isolated between windows", async ({ electronApp, page }) => {
  const firstPage = await dirtyNewFont(page, electronApp);
  const secondPage = await createAnotherDirtyFont(firstPage, electronApp);
  const firstGlyphId = await glyphIdForName(firstPage, "newGlyph");
  const secondGlyphId = await glyphIdForName(secondPage, "newGlyph");
  await Promise.all([
    firstPage.waitForFunction(() => window.shift?.applyStatusCell.peek() === "idle"),
    secondPage.waitForFunction(() => window.shift?.applyStatusCell.peek() === "idle"),
  ]);

  await openGlyphRoute(firstPage, firstGlyphId);
  await addSquare(firstPage);
  const firstEditor = new EditorDriver(firstPage);
  await firstEditor.waitForCanvasRender();
  await firstEditor.selectVisiblePoint();
  await openGlyphRoute(secondPage, secondGlyphId);
  const secondEditor = new EditorDriver(secondPage);

  expect(await secondEditor.selectionIds()).toEqual([]);
  expect(await secondEditor.pointCount()).toBe(0);
  expect(await firstEditor.selectionIds()).toHaveLength(1);
  expect(await firstEditor.pointCount()).toBe(4);

  await firstPage.getByRole("button", { name: "Font overview" }).click();
  await firstPage.waitForURL(/#\/home$/);
  await firstPage.getByRole("button", { name: "Create glyph", exact: true }).click();
  await glyphIdForName(firstPage, "newGlyph.1");
  expect(
    await secondPage.evaluate(() =>
      window.shift?.font.glyphRecords().some((glyph) => glyph.name === "newGlyph.1"),
    ),
  ).toBe(false);
});
