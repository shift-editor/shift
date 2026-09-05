import { expect, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { documentTest as test, waitForWorkspaceReady } from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";
import {
  addSquare,
  hoverVisibleUnselectedPoint,
  selectVisiblePoint,
} from "./fixtures/editorInteractions";
import {
  createNewFont,
  quitApp,
  requestAppQuit,
  runCommand,
  windowTitle,
} from "./fixtures/documentLifecycle";

const discardOnQuitTest = test.extend({
  dirtyDocumentChoice: ["discard", { option: true }],
});
const saveOnQuitTest = test.extend({
  dirtyDocumentChoice: ["save", { option: true }],
});
const reentrantQuitTest = test.extend({
  dirtyDocumentChoices: [["cancel", "discard"], { option: true }],
  dirtyDocumentDelayMs: [150, { option: true }],
});

async function dirtyNewFont(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspacePage = await createNewFont(page, electronApp);
  await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
  await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");
  return workspacePage;
}

async function createAnotherDirtyFont(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const nextWindow = electronApp.waitForEvent("window");
  await runCommand(page, electronApp, "file.new");
  const nextPage = await nextWindow;
  await waitForWorkspaceReady(nextPage);
  await nextPage.getByRole("button", { name: "Create glyph", exact: true }).click();
  await expect.poll(() => windowTitle(nextPage, electronApp)).toContain("Untitled *");
  return nextPage;
}

async function glyphIdForName(page: Page, name: string): Promise<string> {
  await expect
    .poll(() =>
      page.evaluate(
        (glyphName) => window.shift?.font.glyphRecords().some(({ name }) => name === glyphName),
        name,
      ),
    )
    .toBe(true);
  const glyphId = await page.evaluate(
    (glyphName) => window.shift?.font.glyphRecords().find(({ name }) => name === glyphName)?.id,
    name,
  );
  if (!glyphId) throw new Error(`Expected ${name} glyph`);
  return glyphId;
}

async function saveThenDirty(page: Page, savePath: string): Promise<Buffer> {
  await page.evaluate(async (target) => {
    const coordinator = window.shift?.font.editCoordinator;
    if (!coordinator) throw new Error("Expected edit coordinator");

    await coordinator.save(target);
  }, savePath);
  const saved = fs.readFileSync(savePath);
  await page.getByRole("button", { name: "Create glyph", exact: true }).click();
  return saved;
}

test("canceling dirty app quit keeps the document open and dirty", async ({
  electronApp,
  page,
  saveShiftPath,
}) => {
  const workspacePage = await dirtyNewFont(page, electronApp);

  await requestAppQuit(electronApp);
  await workspacePage.waitForTimeout(100);

  await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
  await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");
  expect(fs.existsSync(saveShiftPath)).toBe(false);
});

saveOnQuitTest(
  "saving dirty app quit writes before the process exits",
  async ({ electronApp, page, saveShiftPath }) => {
    await dirtyNewFont(page, electronApp);

    await quitApp(electronApp);

    expect(fs.existsSync(saveShiftPath)).toBe(true);
  },
);

discardOnQuitTest(
  "discarding dirty app quit exits without writing",
  async ({ electronApp, page, saveShiftPath }) => {
    await dirtyNewFont(page, electronApp);

    await quitApp(electronApp);

    expect(fs.existsSync(saveShiftPath)).toBe(false);
  },
);

saveOnQuitTest(
  "saves every dirty document before quitting",
  async ({ electronApp, page, testRoot }) => {
    const firstPage = await dirtyNewFont(page, electronApp);
    const firstPath = path.join(testRoot, "first.shift");
    const firstSaved = await saveThenDirty(firstPage, firstPath);
    const secondPage = await createAnotherDirtyFont(firstPage, electronApp);
    const secondPath = path.join(testRoot, "second.shift");
    const secondSaved = await saveThenDirty(secondPage, secondPath);

    await quitApp(electronApp);

    expect(fs.readFileSync(firstPath).equals(firstSaved)).toBe(false);
    expect(fs.readFileSync(secondPath).equals(secondSaved)).toBe(false);
  },
);

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
  await selectVisiblePoint(firstPage);
  await hoverVisibleUnselectedPoint(firstPage);
  await openGlyphRoute(secondPage, secondGlyphId);

  expect(await secondPage.evaluate(() => window.shift?.editor.selection.ids)).toEqual([]);
  expect(await secondPage.evaluate(() => window.shift?.editor.hover.id)).toBeNull();
  expect((await firstPage.evaluate(() => window.shift?.editor.selection.ids.length)) ?? 0).toBe(1);
  expect(await firstPage.evaluate(() => window.shift?.editor.hover.id)).not.toBeNull();

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

reentrantQuitTest(
  "does not start another confirmation while quit is pending",
  async ({ electronApp, page, saveShiftPath }) => {
    const workspacePage = await dirtyNewFont(page, electronApp);

    await Promise.all([requestAppQuit(electronApp), requestAppQuit(electronApp)]);
    await workspacePage.waitForTimeout(250);

    await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
    expect(fs.existsSync(saveShiftPath)).toBe(false);

    await quitApp(electronApp);
    expect(fs.existsSync(saveShiftPath)).toBe(false);
  },
);
