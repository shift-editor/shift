import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ElectronApplication, Page } from "@playwright/test";
import { createBridge } from "@shift/bridge";
import {
  DESIGNSPACE_FONT_PATH,
  documentTest as test,
  documentWorkspaceTest as workspaceTest,
  expect,
  FONT_PATH,
  GLYPHS_FONT_PATH,
  GLYPHSPACKAGE_FONT_PATH,
  MAIN_JS,
  OTF_FONT_PATH,
  UFO_FONT_PATH,
  waitForWorkspaceReady,
} from "./fixtures/electronApp";
import {
  closeWindow,
  createNewFont,
  killApp,
  quitApp,
  relaunchApp,
  runCommand,
  windowTitle,
} from "./fixtures/documentLifecycle";
import { createAuthoredDocument } from "./fixtures/fontSource";

const execFileAsync = promisify(execFile);

const discardTest = test.extend({
  dirtyDocumentChoice: ["discard", { option: true }],
});
const saveOnCloseTest = test.extend({
  dirtyDocumentChoice: ["save", { option: true }],
});
const saveAsTest = test.extend({
  saveShiftPaths: async ({ saveShiftPath, saveAsShiftPath }, use) => {
    await use([saveShiftPath, saveAsShiftPath]);
  },
});
const copiedDocumentTest = test.extend({
  openFontPath: async ({ copyShiftPath }, use) => {
    await use(copyShiftPath);
  },
});
const cancelSaveTest = test.extend({
  saveShiftPath: async ({}, use) => {
    await use("");
  },
});
const cancelExportTest = workspaceTest.extend({
  exportTtfPath: async ({}, use) => {
    await use("");
  },
});
const failedSaveTest = test.extend({
  saveShiftPath: async ({ testRoot }, use) => {
    const nonDirectory = path.join(testRoot, "not-a-directory");
    fs.writeFileSync(nonDirectory, "blocked");
    await use(path.join(nonDirectory, "saved.shift"));
  },
});
const existingSaveTest = test.extend({
  saveShiftPath: async ({ testRoot }, use) => {
    const saveShiftPath = path.join(testRoot, "saved.shift");
    fs.writeFileSync(saveShiftPath, "replace me");
    await use(saveShiftPath);
  },
});
const failedExportTest = workspaceTest.extend({
  exportTtfPath: async ({ testRoot }, use) => {
    const nonDirectory = path.join(testRoot, "not-a-directory");
    fs.writeFileSync(nonDirectory, "blocked");
    await use(path.join(nonDirectory, "exported.ttf"));
  },
});
const convertiblePreviewTest = test.extend({
  openFontPath: [UFO_FONT_PATH, { option: true }],
});
const cancelPreviewSaveTest = convertiblePreviewTest.extend({
  saveShiftPath: async ({}, use) => {
    await use("");
  },
});
const failedPreviewSaveTest = convertiblePreviewTest.extend({
  saveShiftPath: async ({ testRoot }, use) => {
    const nonDirectory = path.join(testRoot, "not-a-directory");
    fs.writeFileSync(nonDirectory, "blocked");
    await use(path.join(nonDirectory, "converted.shift"));
  },
});
const otfPreviewTest = test.extend({
  openFontPath: [OTF_FONT_PATH, { option: true }],
});

async function openSelectedPreview(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspaceWindow = electronApp.waitForEvent("window");
  await page.getByRole("button", { name: /Load font/ }).click();

  const workspacePage = await workspaceWindow;
  await workspacePage.waitForURL(/#\/home$/);
  await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
  await expect.poll(() => workspacePage.evaluate(() => window.shiftSession?.mode)).toBe("preview");
  return workspacePage;
}

function sourceTreeSnapshot(rootPath: string): [string, string][] {
  if (fs.statSync(rootPath).isFile()) {
    return [[path.basename(rootPath), fs.readFileSync(rootPath, "base64")]];
  }

  const snapshot: [string, string][] = [];
  const visit = (directoryPath: string) => {
    for (const entry of fs
      .readdirSync(directoryPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        snapshot.push([path.relative(rootPath, entryPath), fs.readFileSync(entryPath, "base64")]);
      }
    }
  };
  visit(rootPath);
  return snapshot;
}

workspaceTest(
  "opens a document sent to the running application",
  async ({ electronApp, testRoot }) => {
    const secondPath = createSecondDocument(testRoot);

    await launchSecondInstance(electronApp, testRoot, secondPath);

    await expect.poll(() => electronApp.windows().length).toBe(2);
    await expect.poll(() => hasWindowTitle(electronApp, "second.shift -")).toBe(true);
  },
);

function createSecondDocument(testRoot: string): string {
  const generatedPath = createAuthoredDocument(FONT_PATH, path.join(testRoot, "second-workspace"));
  const secondPath = path.join(testRoot, "second.shift");
  fs.renameSync(generatedPath, secondPath);
  return secondPath;
}

async function launchSecondInstance(
  electronApp: ElectronApplication,
  testRoot: string,
  documentPath: string,
): Promise<void> {
  const executablePath = await electronApp.evaluate(() => process.execPath);
  await execFileAsync(executablePath, [
    MAIN_JS,
    `--user-data-dir=${path.join(testRoot, "user-data")}`,
    documentPath,
  ]);
}

async function hasWindowTitle(
  electronApp: ElectronApplication,
  expected: string,
): Promise<boolean> {
  const titles = await Promise.all(
    electronApp.windows().map((window) => windowTitle(window, electronApp)),
  );
  return titles.some((title) => title.includes(expected));
}

test.describe("opening a font through the application shell", () => {
  test.use({ openFontPath: FONT_PATH });

  test("opens a selected font through the launcher", async ({ electronApp, page }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect(workspacePage.getByRole("dialog", { name: "Read-only preview" })).toBeVisible();
  });

  test("does not convert a TTF preview through Save", async ({
    electronApp,
    page,
    saveShiftPath,
  }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await runCommand(workspacePage, electronApp, "file.save");

    expect(await workspacePage.evaluate(() => window.shiftSession?.mode)).toBe("preview");
    expect(fs.existsSync(saveShiftPath)).toBe(false);
  });
});

otfPreviewTest(
  "does not convert an OTF preview through Save",
  async ({ electronApp, page, saveShiftPath }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await runCommand(workspacePage, electronApp, "file.save");

    expect(await workspacePage.evaluate(() => window.shiftSession?.mode)).toBe("preview");
    expect(fs.existsSync(saveShiftPath)).toBe(false);
  },
);

convertiblePreviewTest(
  "Save converts a preview to an editable Shift document that reopens",
  async ({ electronApp, page, saveShiftPath, testRoot }) => {
    const sourceBefore = sourceTreeSnapshot(UFO_FONT_PATH);
    const workspacePage = await openSelectedPreview(page, electronApp);

    await workspacePage.evaluate(() => {
      void window.shiftHost?.commands.run("file.save");
    });
    await waitForWorkspaceReady(workspacePage);
    await expect
      .poll(() => workspacePage.evaluate(() => window.shiftSession?.mode))
      .toBe("authored");

    expect(fs.existsSync(saveShiftPath)).toBe(true);
    expect(sourceTreeSnapshot(UFO_FONT_PATH)).toEqual(sourceBefore);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("saved.shift *");
    await runCommand(workspacePage, electronApp, "file.save");
    expect(sourceTreeSnapshot(UFO_FONT_PATH)).toEqual(sourceBefore);

    await quitApp(electronApp);
    const relaunchedApp = await relaunchApp(testRoot, saveShiftPath);
    try {
      const launcherPage = await relaunchedApp.firstWindow();
      await launcherPage.waitForURL(/#\/launcher$/);
      const reopenedWindow = relaunchedApp.waitForEvent("window");
      await launcherPage.getByRole("button", { name: /Load font/ }).click();
      const reopenedPage = await reopenedWindow;
      await waitForWorkspaceReady(reopenedPage);

      expect(
        await reopenedPage.evaluate(() =>
          window.shift?.font.glyphRecords().some((glyph) => glyph.name === "newGlyph"),
        ),
      ).toBe(true);
    } finally {
      await killApp(relaunchedApp);
    }
  },
);

for (const { format, sourcePath, sourceRoot } of [
  {
    format: "Designspace",
    sourcePath: DESIGNSPACE_FONT_PATH,
    sourceRoot: path.dirname(DESIGNSPACE_FONT_PATH),
  },
  { format: "Glyphs", sourcePath: GLYPHS_FONT_PATH, sourceRoot: GLYPHS_FONT_PATH },
  {
    format: "Glyphspackage",
    sourcePath: GLYPHSPACKAGE_FONT_PATH,
    sourceRoot: GLYPHSPACKAGE_FONT_PATH,
  },
]) {
  const formatConversionTest = test.extend({
    openFontPath: [sourcePath, { option: true }],
  });

  formatConversionTest(
    `Save As converts a ${format} preview without changing its source`,
    async ({ electronApp, page, saveShiftPath }) => {
      const sourceBefore = sourceTreeSnapshot(sourceRoot);
      const workspacePage = await openSelectedPreview(page, electronApp);

      await workspacePage.evaluate(() => {
        void window.shiftHost?.commands.run("file.saveAs");
      });
      await waitForWorkspaceReady(workspacePage);
      await expect
        .poll(() => workspacePage.evaluate(() => window.shiftSession?.mode))
        .toBe("authored");

      expect(fs.existsSync(saveShiftPath)).toBe(true);
      expect(
        await workspacePage.evaluate(() => window.shift?.font.glyphRecords().length ?? 0),
      ).toBeGreaterThan(0);
      expect(sourceTreeSnapshot(sourceRoot)).toEqual(sourceBefore);
    },
  );
}

cancelPreviewSaveTest(
  "canceling preview Save leaves the source in preview mode",
  async ({ electronApp, page, testRoot }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await runCommand(workspacePage, electronApp, "file.save");

    expect(await workspacePage.evaluate(() => window.shiftSession?.mode)).toBe("preview");
    expect(findShiftDocuments(testRoot)).toEqual([]);
  },
);

failedPreviewSaveTest(
  "failed preview Save preserves the preview and removes conversion state",
  async ({ electronApp, page, saveShiftPath, testRoot }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await expect(runCommand(workspacePage, electronApp, "file.save")).rejects.toThrow();

    expect(await workspacePage.evaluate(() => window.shiftSession?.mode)).toBe("preview");
    expect(fs.existsSync(saveShiftPath)).toBe(false);
    const workspacesRoot = path.join(testRoot, "user-data", "working-documents", "workspaces");
    expect(fs.existsSync(workspacesRoot) ? fs.readdirSync(workspacesRoot) : []).toEqual([]);
  },
);

function savedGlyphNames(documentPath: string, testRoot: string): string[] {
  const bridge = createBridge();
  bridge.openDocument(documentPath, path.join(testRoot, "saved-validation.recovery.sqlite"));

  try {
    return bridge.getGlyphs().map((glyph) => glyph.name);
  } finally {
    bridge.closeWorkspace();
  }
}

function findShiftDocuments(rootPath: string): string[] {
  const documents: string[] = [];
  const visit = (entryPath: string) => {
    if (!fs.existsSync(entryPath)) return;
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(entryPath)) visit(path.join(entryPath, entry));
    } else if (entryPath.endsWith(".shift")) {
      documents.push(entryPath);
    }
  };
  visit(rootPath);
  return documents;
}

test.describe("document lifecycle through the application shell", () => {
  test("first Save writes an independent shift document that reopens", async ({
    electronApp,
    page,
    saveShiftPath,
    testRoot,
  }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");

    await runCommand(workspacePage, electronApp, "file.save");

    await expect.poll(() => fs.existsSync(saveShiftPath)).toBe(true);
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("saved.shift -");
    expect(await windowTitle(workspacePage, electronApp)).not.toContain(" *");

    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("saved.shift *");
    await runCommand(workspacePage, electronApp, "file.save");
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("saved.shift -");

    await quitApp(electronApp);

    const relaunchedApp = await relaunchApp(testRoot, saveShiftPath);
    try {
      const launcherPage = await relaunchedApp.firstWindow();
      await launcherPage.waitForURL(/#\/launcher$/);

      const reopenedWindow = relaunchedApp.waitForEvent("window");
      await launcherPage.getByRole("button", { name: /Load font/ }).click();
      const reopenedPage = await reopenedWindow;
      await reopenedPage.waitForURL(/#\/home$/);
      await expect(reopenedPage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          reopenedPage.evaluate(() =>
            window.shift?.font.glyphRecords().some((glyph) => glyph.name === "newGlyph.1"),
          ),
        )
        .toBe(true);
      await reopenedPage.getByPlaceholder("Search glyphs...").fill("newGlyph.1");
      await expect(
        reopenedPage.getByRole("region", { name: "Glyph catalog surface", exact: true }),
      ).toHaveAttribute("data-filtered-glyph-count", "1");
    } finally {
      await killApp(relaunchedApp);
    }
  });

  test("canceling dirty close keeps the document open and dirty", async ({ electronApp, page }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");

    await closeWindow(workspacePage, electronApp);

    await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");
  });
});

existingSaveTest(
  "first Save replaces an existing selected destination and closes cleanly",
  async ({ electronApp, page, saveShiftPath, testRoot }) => {
    const previousDestination = fs.readFileSync(saveShiftPath);
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();

    await runCommand(workspacePage, electronApp, "file.save");

    await expect
      .poll(() => workspacePage.evaluate(() => window.shift?.documentStateCell.peek()))
      .toMatchObject({ saveTarget: saveShiftPath, needsSaveAs: false, dirty: false });
    expect(fs.readFileSync(saveShiftPath)).not.toEqual(previousDestination);
    await closeWindow(workspacePage, electronApp);
    await expect.poll(() => workspacePage.isClosed()).toBe(true);
    expect(savedGlyphNames(saveShiftPath, testRoot)).toContain("newGlyph");
  },
);

cancelSaveTest(
  "canceling first Save preserves the untitled dirty document",
  async ({ electronApp, page }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");
    const before = await workspacePage.evaluate(async () =>
      window.shift?.font.editCoordinator.state(),
    );

    await runCommand(workspacePage, electronApp, "file.save");

    expect(
      await workspacePage.evaluate(async () => window.shift?.font.editCoordinator.state()),
    ).toEqual(before);
    expect(await windowTitle(workspacePage, electronApp)).toContain("Untitled *");
  },
);

failedSaveTest(
  "failed first Save preserves the untitled dirty document",
  async ({ electronApp, page, saveShiftPath }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");
    const before = await workspacePage.evaluate(async () =>
      window.shift?.font.editCoordinator.state(),
    );

    await expect(runCommand(workspacePage, electronApp, "file.save")).rejects.toThrow();

    expect(
      await workspacePage.evaluate(async () => window.shift?.font.editCoordinator.state()),
    ).toEqual(before);
    expect(await windowTitle(workspacePage, electronApp)).toContain("Untitled *");
    expect(fs.existsSync(saveShiftPath)).toBe(false);
  },
);

discardTest(
  "discarding dirty close closes without writing a package",
  async ({ electronApp, page, saveShiftPath }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");

    await closeWindow(workspacePage, electronApp);

    await expect.poll(() => workspacePage.isClosed()).toBe(true);
    expect(fs.existsSync(saveShiftPath)).toBe(false);
  },
);

discardTest(
  "discarding edits to a saved document reopens its last clean snapshot",
  async ({ electronApp, page, saveShiftPath, testRoot }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await runCommand(workspacePage, electronApp, "file.save");
    await expect.poll(() => fs.existsSync(saveShiftPath)).toBe(true);

    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("saved.shift *");
    await closeWindow(workspacePage, electronApp);
    await expect.poll(() => workspacePage.isClosed()).toBe(true);
    await quitApp(electronApp);

    const relaunchedApp = await relaunchApp(testRoot, saveShiftPath);
    try {
      const launcherPage = await relaunchedApp.firstWindow();
      await launcherPage.waitForURL(/#\/launcher$/);
      const reopenedWindow = relaunchedApp.waitForEvent("window");
      await launcherPage.getByRole("button", { name: /Load font/ }).click();
      const reopenedPage = await reopenedWindow;
      await waitForWorkspaceReady(reopenedPage);

      expect(
        await reopenedPage.evaluate(() =>
          window.shift?.font.glyphRecords().map((glyph) => glyph.name),
        ),
      ).toContain("newGlyph");
      expect(
        await reopenedPage.evaluate(() =>
          window.shift?.font.glyphRecords().map((glyph) => glyph.name),
        ),
      ).not.toContain("newGlyph.1");
      expect(await windowTitle(reopenedPage, relaunchedApp)).not.toContain(" *");
    } finally {
      await killApp(relaunchedApp);
    }
  },
);

saveAsTest(
  "Save As adopts an independent copy without changing the source document",
  async ({ electronApp, page, saveShiftPath, saveAsShiftPath }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await runCommand(workspacePage, electronApp, "file.save");
    await expect.poll(() => fs.existsSync(saveShiftPath)).toBe(true);
    const sourceSnapshot = fs.readFileSync(saveShiftPath);

    await runCommand(workspacePage, electronApp, "file.saveAs");
    await expect.poll(() => fs.existsSync(saveAsShiftPath)).toBe(true);
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("saved-as.shift -");
    const copySnapshot = fs.readFileSync(saveAsShiftPath);
    expect(fs.readFileSync(saveShiftPath)).toEqual(sourceSnapshot);

    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await runCommand(workspacePage, electronApp, "file.save");

    expect(fs.readFileSync(saveShiftPath)).toEqual(sourceSnapshot);
    expect(fs.readFileSync(saveAsShiftPath)).not.toEqual(copySnapshot);
    expect(await windowTitle(workspacePage, electronApp)).toContain("saved-as.shift -");
  },
);

copiedDocumentTest(
  "opening a raw copy reuses the live document session",
  async ({ electronApp, page, saveShiftPath, copyShiftPath }) => {
    const originalPage = await createNewFont(page, electronApp);
    await originalPage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await runCommand(originalPage, electronApp, "file.save");
    await expect.poll(() => fs.existsSync(saveShiftPath)).toBe(true);
    fs.copyFileSync(saveShiftPath, copyShiftPath);

    const originalState = await originalPage.evaluate(async () =>
      window.shift?.font.editCoordinator.state(),
    );
    const originalWindowCount = electronApp.windows().length;
    const sourceSnapshot = fs.readFileSync(saveShiftPath);
    const copySnapshot = fs.readFileSync(copyShiftPath);
    expect(copySnapshot).toEqual(sourceSnapshot);

    await runCommand(originalPage, electronApp, "file.open");

    expect(electronApp.windows()).toHaveLength(originalWindowCount);
    expect(
      await originalPage.evaluate(async () => window.shift?.font.editCoordinator.state()),
    ).toEqual(originalState);
    expect(await windowTitle(originalPage, electronApp)).toContain("saved.shift -");

    await originalPage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(originalPage, electronApp)).toContain("saved.shift *");
    await runCommand(originalPage, electronApp, "file.save");

    expect(fs.readFileSync(copyShiftPath)).toEqual(copySnapshot);
    expect(fs.readFileSync(saveShiftPath)).not.toEqual(sourceSnapshot);
  },
);

saveOnCloseTest(
  "saving dirty close writes the package before closing",
  async ({ electronApp, page, saveShiftPath }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");

    await closeWindow(workspacePage, electronApp);

    await expect.poll(() => workspacePage.isClosed()).toBe(true);
    expect(fs.existsSync(saveShiftPath)).toBe(true);
  },
);

cancelExportTest("canceling Export preserves document state", async ({ electronApp, page }) => {
  const before = await page.evaluate(async () => window.shift?.font.editCoordinator.state());
  await expect.poll(() => windowTitle(page, electronApp)).toContain("font.shift -");
  const titleBefore = await windowTitle(page, electronApp);

  await runCommand(page, electronApp, "file.exportTtf");

  expect(await page.evaluate(async () => window.shift?.font.editCoordinator.state())).toEqual(
    before,
  );
  expect(await windowTitle(page, electronApp)).toBe(titleBefore);
});

failedExportTest(
  "failed Export preserves document state",
  async ({ electronApp, page, exportTtfPath }) => {
    const before = await page.evaluate(async () => window.shift?.font.editCoordinator.state());
    await expect.poll(() => windowTitle(page, electronApp)).toContain("font.shift -");
    const titleBefore = await windowTitle(page, electronApp);

    await runCommand(page, electronApp, "file.exportTtf");

    expect(await page.evaluate(async () => window.shift?.font.editCoordinator.state())).toEqual(
      before,
    );
    expect(await windowTitle(page, electronApp)).toBe(titleBefore);
    expect(fs.existsSync(exportTtfPath)).toBe(false);
  },
);

workspaceTest(
  "Export writes TTF without changing document state",
  async ({ electronApp, page, exportTtfPath }) => {
    const before = await page.evaluate(async () => window.shift?.font.editCoordinator.state());
    await expect.poll(() => windowTitle(page, electronApp)).toContain("font.shift -");
    const titleBefore = await windowTitle(page, electronApp);

    await runCommand(page, electronApp, "file.exportTtf");

    await expect.poll(() => fs.existsSync(exportTtfPath)).toBe(true);
    expect(fs.statSync(exportTtfPath).size).toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(async () => window.shift?.font.editCoordinator.state()))
      .toEqual(before);
    expect(await windowTitle(page, electronApp)).toBe(titleBefore);
  },
);
