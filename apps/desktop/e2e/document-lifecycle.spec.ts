import fs from "node:fs";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  FONTS,
  documentTest as test,
  documentWorkspaceTest as workspaceTest,
  expect,
  waitForWorkspaceReady,
} from "./fixtures/electronApp";
import {
  closeWindow,
  createNewFont,
  dirtyDocumentDecisions,
  launchSecondInstance,
  openFontFromLauncher,
  quitApp,
  requestAppQuit,
  runCommand,
  sessionMode,
  windowTitle,
} from "./fixtures/documentLifecycle";
import { EditorDriver } from "./fixtures/EditorDriver";
import { glyphClickTargets } from "./fixtures/editorInteractions";
import { createAuthoredDocument } from "./fixtures/fontSource";
import { exportedGlyphNames, savedGlyphNames } from "./fixtures/savedDocument";
import {
  clickFirstCatalogGlyph,
  openFirstCatalogGlyph,
  waitForEditorReady,
} from "./fixtures/appLocators";

const discardTest = test.extend({
  dirtyDocumentChoice: "discard",
});
const saveOnCloseTest = test.extend({
  dirtyDocumentChoice: "save",
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
const failedOpenTest = test.extend({
  openFontPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "missing.ufo"));
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
  openFontPath: FONTS.mutatorSansLightCondensed,
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

/** Opens the scripted font from the launcher as a preview and returns its window. */
async function openSelectedPreview(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspacePage = await openFontFromLauncher(page, electronApp);
  await expect.poll(() => sessionMode(workspacePage, electronApp)).toBe("preview");
  return workspacePage;
}

const byEntryName = (left: fs.Dirent, right: fs.Dirent) => left.name.localeCompare(right.name);

function sourceTreeSnapshot(rootPath: string): [string, string][] {
  if (fs.statSync(rootPath).isFile()) {
    return [[path.basename(rootPath), fs.readFileSync(rootPath, "base64")]];
  }

  const snapshot: [string, string][] = [];
  const visit = (directoryPath: string) => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true }).sort(byEntryName)) {
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
  { tag: "@os" },
  async ({ electronApp, testRoot }) => {
    const secondPath = createSecondDocument(testRoot);

    await launchSecondInstance(electronApp, testRoot, secondPath);

    await expect.poll(() => electronApp.windows().length).toBe(2);
    await expect.poll(() => hasWindowTitle(electronApp, "second.shift -")).toBe(true);
  },
);

// Every supported extension shares one activation path in App; a binary file and a
// directory package cover the file-system shapes. Per-format opening is covered by the
// preview Save and Save As conversion tests below.
for (const sourcePath of [FONTS.mutatorSansTtf, FONTS.packageFont]) {
  test.describe(`external ${path.extname(sourcePath)} activation`, () => {
    test.describe("cold launch", () => {
      test.use({ electronArgs: [sourcePath] });

      test(
        "opens the source preview instead of the launcher",
        { tag: "@os" },
        async ({ electronApp, page }) => {
          await expect(page.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
          await expect.poll(() => sessionMode(page, electronApp)).toBe("preview");
          await expect(page).toHaveURL(/#\/home$/);
          expect(electronApp.windows()).toHaveLength(1);
        },
      );
    });

    test(
      "replaces a running launcher with the source preview",
      { tag: "@os" },
      async ({ electronApp, page, testRoot }) => {
        const workspaceWindow = electronApp.waitForEvent("window");
        await launchSecondInstance(electronApp, testRoot, sourcePath);
        const workspacePage = await workspaceWindow;

        await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
        await expect.poll(() => sessionMode(workspacePage, electronApp)).toBe("preview");
        await expect.poll(() => page.isClosed()).toBe(true);
        expect(electronApp.windows()).toHaveLength(1);
      },
    );
  });
}

workspaceTest(
  "source activation preserves an existing document",
  async ({ electronApp, page, testRoot }) => {
    const workspaceWindow = electronApp.waitForEvent("window");
    await launchSecondInstance(electronApp, testRoot, FONTS.mutatorSansTtf);
    const workspacePage = await workspaceWindow;

    await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
    await expect.poll(() => sessionMode(workspacePage, electronApp)).toBe("preview");
    expect(await sessionMode(page, electronApp)).toBe("workspace");
    expect(electronApp.windows()).toHaveLength(2);
  },
);

test.describe("case-insensitive source activation", () => {
  test.use({
    electronArgs: async ({ testRoot }, use) => {
      const sourcePath = path.join(testRoot, "Font With Spaces.TTF");
      fs.copyFileSync(FONTS.mutatorSansTtf, sourcePath);
      await use([sourcePath]);
    },
  });

  test(
    "opens an uppercase source extension with spaces",
    { tag: "@os" },
    async ({ electronApp, page }) => {
      await expect(page.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
      await expect.poll(() => sessionMode(page, electronApp)).toBe("preview");
    },
  );
});

test.describe("unsupported file activation", () => {
  test.use({ electronArgs: [path.join(path.dirname(FONTS.mutatorSansTtf), "ignored.txt")] });

  test("keeps the launcher for unsupported extensions", async ({ electronApp, page }) => {
    await expect(page.getByRole("button", { name: "Open Font…", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#\/launcher$/);
    expect(electronApp.windows()).toHaveLength(1);
  });
});

function createSecondDocument(testRoot: string): string {
  const generatedPath = createAuthoredDocument(
    FONTS.mutatorSansTtf,
    path.join(testRoot, "second-workspace"),
  );
  const secondPath = path.join(testRoot, "second.shift");
  fs.renameSync(generatedPath, secondPath);
  return secondPath;
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
  test.use({ openFontPath: FONTS.mutatorSansTtf });

  test("opens a selected font with disabled authoring controls", async ({ electronApp, page }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    for (const label of ["Create glyph", "Create source", "Create instance", "Create axis"]) {
      await expect(workspacePage.getByRole("button", { name: label, exact: true })).toBeDisabled();
    }
    // The tools float over the glyph editor's canvas, not the glyph catalog.
    await clickFirstCatalogGlyph(workspacePage);
    await workspacePage.waitForURL(/#\/editor\//);
    for (const label of ["Pen Tool (P)", "Rectangle Tool (R)", "Rectangle Tool (R) options"]) {
      await expect(workspacePage.getByRole("button", { name: label, exact: true })).toBeDisabled();
    }

    await workspacePage.getByRole("button", { name: "Read-only preview", exact: true }).click();
    const notice = workspacePage.getByRole("dialog", { name: "This font is view-only" });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      "You can inspect this font, but Shift can’t edit or convert it.",
    );
    await expect(notice.getByRole("button", { name: "Save as Shift…" })).toHaveCount(0);
    await notice.getByRole("button", { name: "OK" }).click();
    await expect(notice).toBeHidden();
  });

  test("preview canvas clicks explain restrictions while marquee stays selection-free", async ({
    electronApp,
    page,
  }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);
    const previewEditor = new EditorDriver(workspacePage, electronApp);
    await clickFirstCatalogGlyph(workspacePage);
    await workspacePage.waitForURL(/#\/editor\//);
    const canvas = workspacePage.locator("#interactive-canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(async () => (await previewEditor.editorView()).glyph).not.toBeNull();

    const targets = await glyphClickTargets(workspacePage);
    const bounds = await previewEditor.canvasBounds();
    const notice = workspacePage.getByRole("dialog", {
      name: "This font is view-only",
      exact: true,
    });
    const targetContext = JSON.stringify({ targets, bounds });
    for (const target of targets) {
      expect(target.x, targetContext).toBeGreaterThanOrEqual(0);
      expect(target.x, targetContext).toBeLessThanOrEqual(bounds.width);
      expect(target.y, targetContext).toBeGreaterThanOrEqual(0);
      expect(target.y, targetContext).toBeLessThanOrEqual(bounds.height);
    }

    for (const point of targets.slice(0, 2)) {
      await workspacePage.mouse.move(bounds.x + point.x, bounds.y + point.y);
      await expect.poll(() => previewEditor.hoverId()).toBeNull();
      await canvas.click({ position: point });
      await expect(notice).toBeVisible();
      await expect.poll(() => previewEditor.selectionIds()).toEqual([]);
      await notice.getByRole("button", { name: "OK", exact: true }).click();
      await expect(notice).toBeHidden();
    }

    await canvas.click({ position: targets[2]! });
    await expect(notice).toBeHidden();

    const point = targets[0]!;
    await workspacePage.mouse.move(bounds.x + point.x, bounds.y + point.y);
    await workspacePage.mouse.down();
    await workspacePage.mouse.move(bounds.x + point.x + 30, bounds.y + point.y + 30, { steps: 5 });
    await expect.poll(() => previewEditor.toolState()).toBe("brushing");
    await expect.poll(() => previewEditor.selectionIds()).toEqual([]);
    await expect(notice).toBeHidden();
    await workspacePage.mouse.up();
    await expect.poll(() => previewEditor.toolState()).toBe("ready");
    await expect.poll(() => previewEditor.selectionIds()).toEqual([]);
  });
});

failedOpenTest("failed Open keeps the launcher available", async ({ electronApp, page }) => {
  await runCommand(page, electronApp, "file.open");

  await expect(page).toHaveURL(/#\/launcher$/);
  expect(electronApp.windows()).toHaveLength(1);
});

for (const { format, fontPath } of [
  { format: "TTF", fontPath: FONTS.mutatorSansTtf },
  { format: "OTF", fontPath: FONTS.mutatorSansOtf },
]) {
  const binaryPreviewTest = test.extend({
    openFontPath: fontPath,
  });

  binaryPreviewTest(
    `does not convert a ${format} preview through Save`,
    async ({ electronApp, page, testRoot }) => {
      const workspacePage = await openSelectedPreview(page, electronApp);

      await runCommand(workspacePage, electronApp, "file.save");

      expect(await sessionMode(workspacePage, electronApp)).toBe("preview");
      expect(findShiftDocuments(testRoot)).toEqual([]);
    },
  );
}

convertiblePreviewTest(
  "convertible previews keep authoring controls disabled until Save",
  async ({ electronApp, page }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    for (const label of ["Create glyph", "Create source", "Create instance", "Create axis"]) {
      await expect(workspacePage.getByRole("button", { name: label, exact: true })).toBeDisabled();
    }
  },
);

convertiblePreviewTest(
  "Save converts a preview to an editable Shift document that reopens",
  async ({ relaunch, electronApp, page, saveShiftPath, testRoot }) => {
    const sourceBefore = sourceTreeSnapshot(FONTS.mutatorSansLightCondensed);
    const workspacePage = await openSelectedPreview(page, electronApp);

    await workspacePage.getByRole("button", { name: "Read-only preview", exact: true }).click();
    const notice = workspacePage.getByRole("dialog", { name: "Save as Shift to edit" });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Save as Shift…" }).click();
    await waitForWorkspaceReady(workspacePage);
    await expect.poll(() => sessionMode(workspacePage, electronApp)).toBe("workspace");

    expect(savedGlyphNames(saveShiftPath, testRoot)).toContain("A");
    expect(sourceTreeSnapshot(FONTS.mutatorSansLightCondensed)).toEqual(sourceBefore);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("saved.shift *");
    await runCommand(workspacePage, electronApp, "file.save");
    expect(sourceTreeSnapshot(FONTS.mutatorSansLightCondensed)).toEqual(sourceBefore);

    await quitApp(electronApp);
    const relaunchedApp = await relaunch();
    const launcherPage = await relaunchedApp.firstWindow();
    await launcherPage.waitForURL(/#\/launcher$/);
    const reopenedWindow = relaunchedApp.waitForEvent("window");
    await launcherPage.getByRole("button", { name: "Open Font…", exact: true }).click();
    const reopenedPage = await reopenedWindow;
    await waitForWorkspaceReady(reopenedPage);

    expect(await new EditorDriver(reopenedPage, relaunchedApp).glyphNames()).toContain("newGlyph");
  },
);

for (const { format, sourcePath, sourceRoot } of [
  {
    format: "Designspace",
    sourcePath: FONTS.mutatorSans,
    sourceRoot: path.dirname(FONTS.mutatorSans),
  },
  { format: "Glyphs", sourcePath: FONTS.mutatorSansGlyphs, sourceRoot: FONTS.mutatorSansGlyphs },
  {
    format: "Glyphspackage",
    sourcePath: FONTS.packageFont,
    sourceRoot: FONTS.packageFont,
  },
]) {
  const formatConversionTest = test.extend({
    openFontPath: sourcePath,
  });

  formatConversionTest(
    `Save As converts a ${format} preview without changing its source`,
    async ({ electronApp, page, saveShiftPath, testRoot }) => {
      const sourceBefore = sourceTreeSnapshot(sourceRoot);
      const workspacePage = await openSelectedPreview(page, electronApp);

      await runCommand(workspacePage, electronApp, "file.saveAs");
      await waitForWorkspaceReady(workspacePage);
      await expect.poll(() => sessionMode(workspacePage, electronApp)).toBe("workspace");

      const workspaceGlyphs = await new EditorDriver(workspacePage, electronApp).glyphNames();
      expect(workspaceGlyphs).toContain("A");
      expect(savedGlyphNames(saveShiftPath, testRoot).sort()).toEqual([...workspaceGlyphs].sort());
      expect(sourceTreeSnapshot(sourceRoot)).toEqual(sourceBefore);
    },
  );
}

convertiblePreviewTest(
  "Save As keeps a preview glyph route in the new workspace",
  async ({ electronApp, page, saveShiftPath, testRoot }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);
    const glyphId = await openFirstCatalogGlyph(workspacePage);

    // Conversion reloads the window into the new workspace.
    const reloaded = workspacePage.waitForEvent("load");
    await runCommand(workspacePage, electronApp, "file.saveAs");
    await reloaded;
    await expect.poll(() => sessionMode(workspacePage, electronApp)).toBe("workspace");

    await waitForEditorReady(workspacePage, glyphId);
    expect(savedGlyphNames(saveShiftPath, testRoot)).toContain("A");
  },
);

cancelPreviewSaveTest(
  "canceling preview Save leaves the source in preview mode",
  async ({ electronApp, page, testRoot }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await runCommand(workspacePage, electronApp, "file.save");

    expect(await sessionMode(workspacePage, electronApp)).toBe("preview");
    expect(findShiftDocuments(testRoot)).toEqual([]);
  },
);

failedPreviewSaveTest(
  "failed preview Save preserves the preview and removes conversion state",
  async ({ electronApp, page, saveShiftPath, testRoot }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await runCommand(workspacePage, electronApp, "file.save");

    expect(await sessionMode(workspacePage, electronApp)).toBe("preview");
    expect(fs.existsSync(saveShiftPath)).toBe(false);
    const workspacesRoot = path.join(testRoot, "user-data", "working-documents", "workspaces");
    expect(fs.existsSync(workspacesRoot) ? fs.readdirSync(workspacesRoot) : []).toEqual([]);
  },
);

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
  test(
    "first Save writes an independent shift document that reopens",
    { tag: "@os" },
    async ({ relaunch, electronApp, page, saveShiftPath }) => {
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

      const relaunchedApp = await relaunch();
      const launcherPage = await relaunchedApp.firstWindow();
      await launcherPage.waitForURL(/#\/launcher$/);

      const reopenedWindow = relaunchedApp.waitForEvent("window");
      await launcherPage.getByRole("button", { name: "Open Font…", exact: true }).click();
      const reopenedPage = await reopenedWindow;
      await reopenedPage.waitForURL(/#\/home$/);
      await expect(reopenedPage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
      await expect
        .poll(() => new EditorDriver(reopenedPage, relaunchedApp).glyphNames())
        .toContain("newGlyph.1");
      await reopenedPage.getByPlaceholder("Search glyphs...").fill("newGlyph.1");
      await expect(
        reopenedPage.getByRole("region", { name: "Glyph catalog surface", exact: true }),
      ).toHaveAttribute("data-filtered-glyph-count", "1");
    },
  );

  test("canceling dirty close keeps the document open and dirty", async ({ electronApp, page }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");

    await closeWindow(workspacePage, electronApp);
    await expect.poll(() => dirtyDocumentDecisions(electronApp)).toEqual(["cancel"]);

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
      .poll(() => new EditorDriver(workspacePage, electronApp).documentState())
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
    const workspace = new EditorDriver(workspacePage, electronApp);
    const before = await workspace.documentState();

    await runCommand(workspacePage, electronApp, "file.save");

    expect(await workspace.documentState()).toEqual(before);
    expect(await windowTitle(workspacePage, electronApp)).toContain("Untitled *");
  },
);

failedSaveTest(
  "failed first Save preserves the untitled dirty document",
  async ({ electronApp, page, saveShiftPath }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");
    const workspace = new EditorDriver(workspacePage, electronApp);
    const before = await workspace.documentState();

    await runCommand(workspacePage, electronApp, "file.save");

    expect(await workspace.documentState()).toEqual(before);
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
  async ({ relaunch, electronApp, page, saveShiftPath }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await runCommand(workspacePage, electronApp, "file.save");
    await expect.poll(() => fs.existsSync(saveShiftPath)).toBe(true);

    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("saved.shift *");
    const childProcess = electronApp.process();
    await closeWindow(workspacePage, electronApp);
    await expect.poll(() => workspacePage.isClosed()).toBe(true);

    // macOS stays open without windows; other platforms quit after the last window closes.
    if (process.platform === "darwin") await requestAppQuit(electronApp);

    await expect.poll(() => childProcess.exitCode).toBe(0);
    await quitApp(electronApp, childProcess);

    const relaunchedApp = await relaunch();
    const launcherPage = await relaunchedApp.firstWindow();
    await launcherPage.waitForURL(/#\/launcher$/);
    const reopenedWindow = relaunchedApp.waitForEvent("window");
    await launcherPage.getByRole("button", { name: "Open Font…", exact: true }).click();
    const reopenedPage = await reopenedWindow;
    await waitForWorkspaceReady(reopenedPage);

    const reopenedGlyphs = await new EditorDriver(reopenedPage, relaunchedApp).glyphNames();
    expect(reopenedGlyphs).toContain("newGlyph");
    expect(reopenedGlyphs).not.toContain("newGlyph.1");
    expect(await windowTitle(reopenedPage, relaunchedApp)).not.toContain(" *");
  },
);

saveAsTest(
  "Save As adopts an independent copy without changing the source document",
  async ({ electronApp, page, saveShiftPath, saveAsShiftPath, testRoot }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await runCommand(workspacePage, electronApp, "file.save");
    await expect.poll(() => fs.existsSync(saveShiftPath)).toBe(true);
    const sourceSnapshot = fs.readFileSync(saveShiftPath);

    await runCommand(workspacePage, electronApp, "file.saveAs");
    await expect.poll(() => fs.existsSync(saveAsShiftPath)).toBe(true);
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("saved-as.shift -");
    expect(savedGlyphNames(saveAsShiftPath, testRoot)).toEqual(["newGlyph"]);
    expect(fs.readFileSync(saveShiftPath)).toEqual(sourceSnapshot);

    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await runCommand(workspacePage, electronApp, "file.save");

    expect(fs.readFileSync(saveShiftPath)).toEqual(sourceSnapshot);
    expect(savedGlyphNames(saveAsShiftPath, testRoot)).toEqual(["newGlyph", "newGlyph.1"]);
    expect(await windowTitle(workspacePage, electronApp)).toContain("saved-as.shift -");
  },
);

copiedDocumentTest(
  "opening a raw copy reuses the live document session",
  async ({ electronApp, page, saveShiftPath, copyShiftPath, testRoot }) => {
    const originalPage = await createNewFont(page, electronApp);
    await originalPage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await runCommand(originalPage, electronApp, "file.save");
    await expect.poll(() => fs.existsSync(saveShiftPath)).toBe(true);
    fs.copyFileSync(saveShiftPath, copyShiftPath);

    const original = new EditorDriver(originalPage, electronApp);
    const originalState = await original.documentState();
    const originalWindowCount = electronApp.windows().length;
    const sourceSnapshot = fs.readFileSync(saveShiftPath);
    const copySnapshot = fs.readFileSync(copyShiftPath);
    expect(copySnapshot).toEqual(sourceSnapshot);

    await runCommand(originalPage, electronApp, "file.open");

    expect(electronApp.windows()).toHaveLength(originalWindowCount);
    expect(await original.documentState()).toEqual(originalState);
    expect(await windowTitle(originalPage, electronApp)).toContain("saved.shift -");

    await originalPage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(originalPage, electronApp)).toContain("saved.shift *");
    await runCommand(originalPage, electronApp, "file.save");

    expect(fs.readFileSync(copyShiftPath)).toEqual(copySnapshot);
    expect(savedGlyphNames(saveShiftPath, testRoot)).toContain("newGlyph.1");
  },
);

saveOnCloseTest(
  "saving dirty close writes the package before closing",
  async ({ electronApp, page, saveShiftPath, testRoot }) => {
    const workspacePage = await createNewFont(page, electronApp);
    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");

    await closeWindow(workspacePage, electronApp);

    await expect.poll(() => workspacePage.isClosed()).toBe(true);
    expect(savedGlyphNames(saveShiftPath, testRoot)).toContain("newGlyph");
  },
);

cancelExportTest("canceling Export preserves document state", async ({ electronApp, page }) => {
  const workspace = new EditorDriver(page, electronApp);
  const before = await workspace.documentState();
  await expect.poll(() => windowTitle(page, electronApp)).toContain("font.shift -");
  const titleBefore = await windowTitle(page, electronApp);

  await runCommand(page, electronApp, "file.exportTtf");

  expect(await workspace.documentState()).toEqual(before);
  expect(await windowTitle(page, electronApp)).toBe(titleBefore);
});

failedExportTest(
  "failed Export preserves document state",
  async ({ electronApp, page, exportTtfPath }) => {
    const workspace = new EditorDriver(page, electronApp);
    const before = await workspace.documentState();
    await expect.poll(() => windowTitle(page, electronApp)).toContain("font.shift -");
    const titleBefore = await windowTitle(page, electronApp);

    await runCommand(page, electronApp, "file.exportTtf");

    expect(await workspace.documentState()).toEqual(before);
    expect(await windowTitle(page, electronApp)).toBe(titleBefore);
    expect(fs.existsSync(exportTtfPath)).toBe(false);
  },
);

workspaceTest(
  "Export writes TTF without changing document state",
  { tag: "@os" },
  async ({ electronApp, page, exportTtfPath }) => {
    const workspace = new EditorDriver(page, electronApp);
    const before = await workspace.documentState();
    await expect.poll(() => windowTitle(page, electronApp)).toContain("font.shift -");
    const titleBefore = await windowTitle(page, electronApp);

    await runCommand(page, electronApp, "file.exportTtf");

    await expect.poll(() => fs.existsSync(exportTtfPath)).toBe(true);
    const workspaceGlyphs = await workspace.glyphNames();
    expect(workspaceGlyphs).toContain("A");
    expect(exportedGlyphNames(exportTtfPath)).toEqual(expect.arrayContaining([...workspaceGlyphs]));
    await expect.poll(() => workspace.documentState()).toEqual(before);
    expect(await windowTitle(page, electronApp)).toBe(titleBefore);
  },
);
