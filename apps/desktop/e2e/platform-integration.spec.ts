import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ElectronApplication, Page, TestInfo } from "@playwright/test";
import {
  appRuntime,
  documentTest as test,
  expect,
  rendererHostPlatform,
  waitForWorkspaceReady,
} from "./fixtures/electronApp";
import {
  createNewFont,
  glyphIdForName,
  openFontFromLauncher,
  quitApp,
  runCommand,
} from "./fixtures/documentLifecycle";
import { EditorDriver } from "./fixtures/EditorDriver";
import type { RelaunchApp } from "./fixtures/types";
import type { GlyphId } from "@shift/types";
import { square } from "@/testing/fixtures";

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
  "uses platform-appropriate window controls",
  { tag: "@os" },
  async ({ electronApp, page }) => {
    const { platform } = await appRuntime(electronApp);
    const rendererPlatform = await rendererHostPlatform(page);
    const customWindowControls = page.getByRole("toolbar", { name: "Window controls" });

    expect(rendererPlatform).toBe(platform);
    await expect(customWindowControls).toHaveCount(platform === "darwin" ? 1 : 0);
  },
);

platformTest(
  "saves, exports, and reopens through Unicode paths with inspectable evidence",
  { tag: "@os" },
  async ({ electronApp, page, saveShiftPath, exportTtfPath, relaunch }, testInfo) => {
    await attachScreenshot(testInfo, "launcher", page);
    const { workspacePage, glyphId } = await createEvidenceDocument(electronApp, page, testInfo);
    await persistEvidence(electronApp, workspacePage, saveShiftPath, exportTtfPath, testInfo);
    await reopenAndVerify(electronApp, relaunch, glyphId, testInfo);
  },
);

async function createEvidenceDocument(
  electronApp: ElectronApplication,
  page: Page,
  testInfo: TestInfo,
): Promise<{ workspacePage: Page; glyphId: GlyphId }> {
  const workspacePage = await createNewFont(page, electronApp);
  await attachScreenshot(testInfo, "glyph-catalog", workspacePage);
  await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
  const glyphId = await glyphIdForName(workspacePage, "newGlyph");
  const editor = new EditorDriver(workspacePage, electronApp);
  await expect.poll(async () => (await editor.editorView()).applyStatus).toBe("idle");
  await editor.openGlyph(glyphId);
  expect(await editor.pointCount()).toBe(0);
  await editor.draw({ contours: [square(100)] });
  expect(await editor.pointCount()).toBe(4);
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
  relaunch: RelaunchApp,
  glyphId: GlyphId,
  testInfo: TestInfo,
): Promise<void> {
  await quitApp(electronApp);
  const relaunchedApp = await relaunch();

  const launcherPage = await relaunchedApp.firstWindow();
  await launcherPage.waitForURL(/#\/launcher$/);
  const workspacePage = await openFontFromLauncher(launcherPage, relaunchedApp);
  await waitForWorkspaceReady(workspacePage);
  const editor = new EditorDriver(workspacePage, relaunchedApp);
  await editor.openGlyph(glyphId);
  expect(await editor.pointCount()).toBe(4);
  await attachScreenshot(testInfo, "reopened-editor", workspacePage);
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
  const runtime = await appRuntime(electronApp);
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
