import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ElectronApplication, Page, TestInfo } from "@playwright/test";
import { documentTest as test, expect, waitForWorkspaceReady } from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";
import {
  createNewFont,
  killApp,
  quitApp,
  relaunchApp,
  runCommand,
} from "./fixtures/documentLifecycle";
import { addSquare } from "./fixtures/editorInteractions";

const platformTest = test.extend({
  saveShiftPath: async ({ testRoot }, use) => {
    const directory = path.join(testRoot, "Saved fonts – ünicode");
    fs.mkdirSync(directory, { recursive: true });
    await use(path.join(directory, "試験 font.shift"));
  },
  exportTtfPath: async ({ testRoot }, use) => {
    const directory = path.join(testRoot, "Exported fonts – ünicode");
    fs.mkdirSync(directory, { recursive: true });
    await use(path.join(directory, "書体 evidence.ttf"));
  },
});

platformTest(
  "saves, exports, and reopens through Unicode paths with inspectable evidence",
  async ({ electronApp, page, saveShiftPath, exportTtfPath, testRoot }, testInfo) => {
    await attachScreenshot(testInfo, "launcher", page);
    const { workspacePage, glyphId } = await createEvidenceDocument(electronApp, page, testInfo);
    await persistEvidence(electronApp, workspacePage, saveShiftPath, exportTtfPath, testInfo);
    await reopenAndVerify(electronApp, testRoot, saveShiftPath, glyphId, testInfo);
  },
);

async function createEvidenceDocument(
  electronApp: ElectronApplication,
  page: Page,
  testInfo: TestInfo,
): Promise<{ workspacePage: Page; glyphId: string }> {
  const workspacePage = await createNewFont(page, electronApp);
  await attachScreenshot(testInfo, "glyph-catalog", workspacePage);
  await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
  const glyphId = await glyphIdForName(workspacePage, "newGlyph");
  await workspacePage.waitForFunction(() => window.shift?.applyStatusCell.peek() === "idle");
  await openGlyphRoute(workspacePage, glyphId);
  expect(await activeGlyphPointCount(workspacePage)).toBe(0);
  expect(await addSquare(workspacePage)).toBe(4);
  await attachScreenshot(testInfo, "editor", workspacePage);
  return { workspacePage, glyphId };
}

async function persistEvidence(
  electronApp: ElectronApplication,
  page: Page,
  saveShiftPath: string,
  exportTtfPath: string,
  testInfo: TestInfo,
): Promise<void> {
  await runCommand(page, electronApp, "file.save");
  await expect.poll(() => fs.existsSync(saveShiftPath)).toBe(true);
  await runCommand(page, electronApp, "file.exportTtf");
  await expect.poll(() => fs.existsSync(exportTtfPath)).toBe(true);

  await testInfo.attach("saved-document", {
    path: saveShiftPath,
    contentType: "application/x-shift-document",
  });
  await testInfo.attach("exported-font", {
    path: exportTtfPath,
    contentType: "font/ttf",
  });
  await attachManifest(testInfo, electronApp, saveShiftPath, exportTtfPath);
}

async function reopenAndVerify(
  electronApp: ElectronApplication,
  testRoot: string,
  saveShiftPath: string,
  glyphId: string,
  testInfo: TestInfo,
): Promise<void> {
  await quitApp(electronApp);
  const relaunchedApp = await relaunchApp(testRoot, saveShiftPath);

  try {
    const launcherPage = await relaunchedApp.firstWindow();
    await launcherPage.waitForURL(/#\/launcher$/);
    const workspaceWindow = relaunchedApp.waitForEvent("window");
    await launcherPage.getByRole("button", { name: /Load font/ }).click();
    const workspacePage = await workspaceWindow;
    await waitForWorkspaceReady(workspacePage);
    await openGlyphRoute(workspacePage, glyphId);
    expect(await activeGlyphPointCount(workspacePage)).toBe(4);
    await attachScreenshot(testInfo, "reopened-editor", workspacePage);
  } finally {
    await killApp(relaunchedApp);
  }
}

async function glyphIdForName(page: Page, glyphName: string): Promise<string> {
  await expect
    .poll(() =>
      page.evaluate(
        (name) => window.shift?.font.glyphRecords().find((glyph) => glyph.name === name)?.id,
        glyphName,
      ),
    )
    .not.toBeUndefined();
  const glyphId = await page.evaluate(
    (name) => window.shift?.font.glyphRecords().find((glyph) => glyph.name === name)?.id,
    glyphName,
  );
  if (!glyphId) throw new Error(`Expected ${glyphName} glyph`);
  return glyphId;
}

async function activeGlyphPointCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const editor = window.shift?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    const glyph = node ? editor?.glyphForId(node.glyphId) : null;
    if (!node || !glyph) throw new Error("Expected active glyph editor");
    return glyph.layerForSource(node.sourceId)?.pointCount ?? 0;
  });
}

async function attachScreenshot(testInfo: TestInfo, name: string, page: Page): Promise<void> {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

async function attachManifest(
  testInfo: TestInfo,
  electronApp: ElectronApplication,
  saveShiftPath: string,
  exportTtfPath: string,
): Promise<void> {
  const runtime = await electronApp.evaluate(({ app }) => ({
    platform: process.platform,
    architecture: process.arch,
    electronVersion: process.versions.electron,
    appVersion: app.getVersion(),
  }));
  const files = [saveShiftPath, exportTtfPath].map((filePath) => ({
    name: path.basename(filePath),
    bytes: fs.statSync(filePath).size,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
  }));

  const manifestPath = testInfo.outputPath("platform-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ ...runtime, files }, null, 2));
  await testInfo.attach("platform-manifest", {
    path: manifestPath,
    contentType: "application/json",
  });
}
