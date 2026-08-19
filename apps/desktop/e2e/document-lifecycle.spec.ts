import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import {
  documentTest as test,
  documentWorkspaceTest as workspaceTest,
  expect,
  FONT_PATH,
  MAIN_JS,
} from "./fixtures/electronApp";

const discardTest = test.extend({
  dirtyDocumentChoice: ["discard", { option: true }],
});
const saveOnCloseTest = test.extend({
  dirtyDocumentChoice: ["save", { option: true }],
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
const failedExportTest = workspaceTest.extend({
  exportTtfPath: async ({ testRoot }, use) => {
    const nonDirectory = path.join(testRoot, "not-a-directory");
    fs.writeFileSync(nonDirectory, "blocked");
    await use(path.join(nonDirectory, "exported.ttf"));
  },
});

async function createNewFont(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspaceWindow = electronApp.waitForEvent("window");
  await page.getByRole("button", { name: "New font", exact: true }).click();

  const workspacePage = await workspaceWindow;
  await workspacePage.waitForURL(/#\/home$/);
  await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
  return workspacePage;
}

async function runCommand(
  page: Page,
  electronApp: ElectronApplication,
  command: "file.save" | "file.exportTtf",
): Promise<void> {
  const browserWindow = await electronApp.browserWindow(page);
  await expect
    .poll(() =>
      browserWindow.evaluate((window) => {
        window.focus();
        return window.isFocused();
      }),
    )
    .toBe(true);
  await browserWindow.dispose();

  await page.evaluate(async (id) => {
    const host = window.shiftHost;
    if (!host) throw new Error("Expected Shift host");

    await host.commands.run(id);
  }, command);
}

async function windowTitle(page: Page, electronApp: ElectronApplication): Promise<string> {
  const browserWindow = await electronApp.browserWindow(page);
  const title = await browserWindow.evaluate((window) => window.getTitle());
  await browserWindow.dispose();
  return title;
}

async function closeWindow(page: Page, electronApp: ElectronApplication): Promise<void> {
  const browserWindow = await electronApp.browserWindow(page);
  await browserWindow.evaluate((window) => window.close());
  await browserWindow.dispose();
}

async function quitApp(electronApp: ElectronApplication): Promise<void> {
  const childProcess = electronApp.process();
  const exited = once(childProcess, "exit");
  await electronApp.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
  await exited;
}

async function relaunchApp(testRoot: string, saveShiftPath: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [
      MAIN_JS,
      `--user-data-dir=${path.join(testRoot, "user-data")}`,
      "--force-device-scale-factor=1",
    ],
    env: {
      ...process.env,
      NODE_ENV: "test",
      LIBGL_ALWAYS_SOFTWARE: "1",
      SHIFT_E2E_NATIVE_DIALOGS: "1",
      SHIFT_E2E_OPEN_FONT_PATH: saveShiftPath,
      SHIFT_E2E_SAVE_SHIFT_PATH: saveShiftPath,
    },
  });
}

async function killApp(electronApp: ElectronApplication): Promise<void> {
  const childProcess = electronApp.process();
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;

  const exited = once(childProcess, "exit");
  childProcess.kill("SIGKILL");
  await exited;
}

test.describe("opening a font through the application shell", () => {
  test.use({ openFontPath: FONT_PATH });

  test("opens a selected font through the launcher", async ({ electronApp, page }) => {
    const workspaceWindow = electronApp.waitForEvent("window");

    await page.getByRole("button", { name: /Load font/ }).click();

    const workspacePage = await workspaceWindow;
    await workspacePage.waitForURL(/#\/home$/);
    await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();

    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect(workspacePage.getByRole("dialog", { name: "Read-only preview" })).toBeVisible();
  });
});

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
