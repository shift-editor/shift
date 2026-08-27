import fs from "node:fs";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  documentTest as launcherTest,
  documentWorkspaceTest as authoredTest,
  expect,
  FONT_PATH,
  UFO_FONT_PATH,
  waitForWorkspaceReady,
} from "./fixtures/electronApp";
import { applicationMenuItemEnabled, clickApplicationMenuItem } from "./fixtures/documentLifecycle";

const binaryPreviewTest = launcherTest.extend({
  openFontPath: [FONT_PATH, { option: true }],
});
const convertiblePreviewTest = launcherTest.extend({
  openFontPath: [UFO_FONT_PATH, { option: true }],
});

async function openSelectedPreview(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspaceWindow = electronApp.waitForEvent("window");
  await page.getByRole("button", { name: /Load font/ }).click();

  const workspacePage = await workspaceWindow;
  await workspacePage.waitForURL(/#\/home$/);
  await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
  return workspacePage;
}

async function openFirstAuthoredGlyph(page: Page): Promise<void> {
  const glyphId = await page.evaluate(async () => {
    const session = window.shiftSession;
    const entry = session?.font.glyphEntries()[0];
    if (!session || !entry) throw new Error("Expected authored glyph entry");

    await session.font.loadGlyph(entry.id);
    window.location.hash = `#/editor/${encodeURIComponent(entry.id)}`;
    return entry.id;
  });
  await page.waitForURL(new RegExp(`#/editor/${encodeURIComponent(glyphId)}$`));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = window.shiftSession?.editor;
        const node = editor?.scene.nodesOfKind("glyph")[0];
        return Boolean(
          editor && node && editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId),
        );
      }),
    )
    .toBe(true);
}

async function canvasPointCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const editor = window.shiftSession?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    if (!editor || !node) throw new Error("Expected active glyph editor");
    return editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId)?.pointCount ?? 0;
  });
}

launcherTest("application menu exposes native shell actions", async ({ electronApp, page }) => {
  await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "window.close")).toBe(true);

  const menu = await electronApp.evaluate(({ app, Menu }) => ({
    packaged: app.isPackaged,
    platform: process.platform,
    topLevelLabels: Menu.getApplicationMenu()?.items.map((item) => item.label) ?? [],
    topLevelRoles: Menu.getApplicationMenu()?.items.map((item) => item.role?.toLowerCase()) ?? [],
    roles:
      Menu.getApplicationMenu()?.items.flatMap(
        (item) =>
          item.submenu?.items.map((child) => child.role?.toLowerCase()).filter(Boolean) ?? [],
      ) ?? [],
    viewLabels:
      Menu.getApplicationMenu()
        ?.items.find((item) => item.label === "View")
        ?.submenu?.items.map((item) => item.label) ?? [],
    interfaceSizeLabels:
      Menu.getApplicationMenu()
        ?.items.find((item) => item.label === "View")
        ?.submenu?.items.find((item) => item.label === "Interface Size")
        ?.submenu?.items.map((item) => item.label) ?? [],
    fileIds:
      Menu.getApplicationMenu()
        ?.items.find((item) => item.label === "File")
        ?.submenu?.items.map((item) => item.id) ?? [],
    editIds:
      Menu.getApplicationMenu()
        ?.items.find((item) => item.label === "Edit")
        ?.submenu?.items.map((item) => item.id) ?? [],
    helpIds:
      Menu.getApplicationMenu()
        ?.items.find((item) => item.label === "Help")
        ?.submenu?.items.map((item) => item.id) ?? [],
    settingsAccelerator:
      Menu.getApplicationMenu()?.getMenuItemById("app.showSettings")?.accelerator,
  }));

  if (menu.platform === "darwin") {
    expect(menu.topLevelLabels).toContain("Window");
    expect(menu.topLevelRoles).toContain("windowmenu");
    expect(menu.roles).toEqual(
      expect.arrayContaining([
        "services",
        "hide",
        "hideothers",
        "unhide",
        "minimize",
        "zoom",
        "front",
      ]),
    );
  } else {
    expect(menu.roles).toContain("quit");
  }

  expect(menu.fileIds).not.toContain("app.showSettings");
  expect(menu.editIds.includes("app.showSettings")).toBe(menu.platform !== "darwin");
  expect(menu.helpIds).toEqual(
    expect.arrayContaining([
      "help.openWebsite",
      "help.openDiscord",
      "help.openX",
      "help.reportIssue",
    ]),
  );
  expect(menu.settingsAccelerator).toBe("CmdOrCtrl+,");
  expect(menu.viewLabels).toEqual(
    expect.arrayContaining(["Zoom In", "Zoom Out", "Interface Size"]),
  );
  expect(menu.interfaceSizeLabels).toEqual(["Increase", "Decrease", "Reset"]);
  expect(menu.viewLabels.includes("Developer")).toBe(!menu.packaged && menu.platform === "darwin");
});

authoredTest("Settings opens the active font configuration", async ({ electronApp, page }) => {
  await clickApplicationMenuItem(page, electronApp, "app.showSettings");

  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Font", exact: true })).toBeVisible();
});

convertiblePreviewTest(
  "View menu distinguishes canvas zoom from interface size",
  async ({ electronApp, page }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);
    await clickApplicationMenuItem(workspacePage, electronApp, "file.save");
    await waitForWorkspaceReady(workspacePage);

    const browserWindow = await electronApp.browserWindow(workspacePage);
    const originalInterfaceSize = await browserWindow.evaluate((window) =>
      window.webContents.getZoomFactor(),
    );
    const originalCanvasZoom = await workspacePage.evaluate(
      () => window.shiftSession?.editor.zoom ?? 0,
    );

    await clickApplicationMenuItem(workspacePage, electronApp, "view.zoomIn");
    const canvasZoom = await workspacePage.evaluate(() => window.shiftSession?.editor.zoom ?? 0);
    expect(canvasZoom).toBeGreaterThan(originalCanvasZoom);
    expect(await browserWindow.evaluate((window) => window.webContents.getZoomFactor())).toBe(
      originalInterfaceSize,
    );

    await clickApplicationMenuItem(workspacePage, electronApp, "ui.increaseSize");
    expect(
      await browserWindow.evaluate((window) => window.webContents.getZoomFactor()),
    ).toBeGreaterThan(originalInterfaceSize);
    expect(await workspacePage.evaluate(() => window.shiftSession?.editor.zoom ?? 0)).toBe(
      canvasZoom,
    );
    await browserWindow.dispose();
  },
);

authoredTest("Home focuses one reusable launcher window", async ({ electronApp, page }) => {
  authoredTest.skip(process.platform !== "darwin", "Home currently lives in the macOS Window menu");
  const initialWindowCount = electronApp.windows().length;
  const launcherOpened = electronApp.waitForEvent("window");

  await clickApplicationMenuItem(page, electronApp, "window.showHome");
  const launcher = await launcherOpened;
  await launcher.waitForURL(/#\/launcher$/);
  expect(electronApp.windows()).toHaveLength(initialWindowCount + 1);

  await clickApplicationMenuItem(page, electronApp, "window.showHome");
  expect(electronApp.windows()).toHaveLength(initialWindowCount + 1);
  await expect.poll(() => launcher.evaluate(() => document.hasFocus())).toBe(true);
});

launcherTest(
  "application menu disables document commands on the launcher",
  async ({ electronApp, page }) => {
    await expect
      .poll(() => applicationMenuItemEnabled(page, electronApp, "app.showSettings"))
      .toBe(false);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "file.new")).toBe(true);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "file.open")).toBe(true);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "file.save")).toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(page, electronApp, "file.saveAs"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(page, electronApp, "file.exportTtf"))
      .toBe(false);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "edit.copy")).toBe(false);
  },
);

binaryPreviewTest(
  "application menu keeps binary previews read-only",
  async ({ electronApp, page }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "app.showSettings"))
      .toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.save"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.saveAs"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.exportTtf"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "edit.copy"))
      .toBe(false);
  },
);

convertiblePreviewTest(
  "application menu converts a preview and refreshes authored capabilities",
  async ({ electronApp, page, saveShiftPath }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.save"))
      .toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.saveAs"))
      .toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.exportTtf"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "edit.copy"))
      .toBe(false);

    await clickApplicationMenuItem(workspacePage, electronApp, "file.save");
    await waitForWorkspaceReady(workspacePage);
    await expect
      .poll(() => workspacePage.evaluate(() => window.shiftSession?.mode))
      .toBe("authored");
    expect(fs.existsSync(saveShiftPath)).toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.exportTtf"))
      .toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "edit.copy"))
      .toBe(true);
  },
);

authoredTest(
  "native Edit menu targets text controls and canvas authoring",
  async ({ electronApp, page }) => {
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "file.save")).toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(page, electronApp, "file.exportTtf"))
      .toBe(true);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "edit.copy")).toBe(true);

    const search = page.getByPlaceholder("Search glyphs...");
    await search.fill("Alpha");
    await search.evaluate((input) => {
      input.focus();
      input.setSelectionRange(0, input.value.length);
    });
    await clickApplicationMenuItem(page, electronApp, "edit.copy");
    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe("Alpha");

    await electronApp.evaluate(({ clipboard }) => clipboard.writeText("Beta"));
    await clickApplicationMenuItem(page, electronApp, "edit.paste");
    await expect(search).toHaveValue("Beta");
    await search.fill("");

    await openFirstAuthoredGlyph(page);
    const originalPointCount = await canvasPointCount(page);
    expect(originalPointCount).toBeGreaterThan(0);

    await clickApplicationMenuItem(page, electronApp, "edit.selectAll");
    await expect
      .poll(() => page.evaluate(() => window.shiftSession?.editor.selection.ids.length ?? 0))
      .toBe(originalPointCount);
    await clickApplicationMenuItem(page, electronApp, "edit.copy");
    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .not.toBe("");

    await clickApplicationMenuItem(page, electronApp, "edit.paste");
    await expect.poll(() => canvasPointCount(page)).toBe(originalPointCount * 2);

    await clickApplicationMenuItem(page, electronApp, "edit.undo");
    await expect.poll(() => canvasPointCount(page)).toBe(originalPointCount);
    await clickApplicationMenuItem(page, electronApp, "edit.redo");
    await expect.poll(() => canvasPointCount(page)).toBe(originalPointCount * 2);

    await clickApplicationMenuItem(page, electronApp, "edit.deleteSelection");
    await expect.poll(() => canvasPointCount(page)).toBe(originalPointCount);
    await clickApplicationMenuItem(page, electronApp, "edit.undo");
    await expect.poll(() => canvasPointCount(page)).toBe(originalPointCount * 2);

    await clickApplicationMenuItem(page, electronApp, "edit.selectAll");
    await clickApplicationMenuItem(page, electronApp, "edit.cut");
    await expect.poll(() => canvasPointCount(page)).toBe(0);
    await clickApplicationMenuItem(page, electronApp, "edit.undo");
    await expect.poll(() => canvasPointCount(page)).toBe(originalPointCount * 2);
  },
);
