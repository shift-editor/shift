import { test as base, type ElectronApplication, type Page } from "@playwright/test";
import { createBridge } from "@shift/bridge";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import * as path from "path";
import { createAuthoredDocument } from "./fontSource";
import type {
  CanonicalVariableFont,
  RecordedDialog,
  RecoveryApp,
  ShiftFixtures,
  ShiftOptions,
  ShiftWorkerFixtures,
  SharedWorkspace,
} from "./types";
import { FONT_FILES, type FontFixture, type FontName } from "@/testing/fonts";
import { buildFontFixture } from "./buildFontFixture";
import { EditorDriver } from "./EditorDriver";
import { expect } from "./matchers";
import { ElectronProcesses, killApp } from "./electronProcesses";
import { hooksOf } from "./appHooks";

export type { CanonicalVariableFont, RecoveryApp } from "./types";
export { killApp, MAIN_JS } from "./electronProcesses";

const APP_ROOT = path.resolve(__dirname, "../..");
/**
 * The font files in the repository's `fixtures/fonts` that tests open, by what they hold, as
 * absolute paths: the same names vitest's `FONTS` has.
 */
export const FONTS = Object.fromEntries(
  Object.entries(FONT_FILES).map(([name, file]) => [
    name,
    path.resolve(APP_ROOT, "../../fixtures/fonts", file),
  ]),
) as { readonly [Name in FontName]: string };

/**
 * Builds a software-rendered test environment that inherits no Shift E2E settings.
 *
 * @remarks
 * Developers export variables such as `SHIFT_E2E_FONT_PATH` for GPU runs. Every launch,
 * relaunch, and second instance starts from this environment so a shell setting cannot
 * open extra documents or change scripted dialog choices.
 *
 * @param overrides - Shift E2E variables owned by the launching fixture.
 * @returns environment for an Electron process under test.
 */
export function shiftTestEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith("SHIFT_E2E_")) environment[name] = value;
  }

  return {
    ...environment,
    NODE_ENV: "test",
    // Force software rendering for deterministic GPU-free snapshots.
    LIBGL_ALWAYS_SOFTWARE: "1",
    ...overrides,
  };
}

/** Base fixture for launcher tests; workspace tests override `startupFontPath`. */
export const test = base.extend<ShiftFixtures & ShiftOptions, ShiftWorkerFixtures>({
  sharedWorkspaceApp: [
    async ({}, use, workerInfo) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "shift-e2e-shared-"));
      const processes = new ElectronProcesses();
      let shared: Promise<SharedWorkspace> | undefined;
      const launch = async (): Promise<SharedWorkspace> => {
        const workspacePath = createAuthoredDocument(
          FONTS.mutatorSansTtf,
          path.join(root, "workspace"),
        );
        const app = await processes.launch({
          label: "shared",
          userDataDir: path.join(root, "user-data"),
          args: [workspacePath],
          env: shiftTestEnvironment(),
          windowSizing: workerInfo.project.name === "visual" ? "visual" : "native",
        });
        return { app, processes };
      };
      try {
        await use(() => (shared ??= launch()));
      } finally {
        await processes.terminateAll();
        await fs.promises.rm(root, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      }
    },
    { scope: "worker" },
  ],
  sharedWorkspace: [false, { option: true }],
  startupFontPath: [undefined, { option: true }],
  windowSizing: [
    async ({}, use, testInfo) => {
      await use(testInfo.project.name === "visual" ? "visual" : "native");
    },
    { option: true },
  ],
  electronArgs: [[], { option: true }],
  scriptedDialogs: [false, { option: true }],
  openFontPath: [undefined, { option: true }],
  saveShiftPaths: [undefined, { option: true }],
  font: [undefined, { option: true }],
  dirtyDocumentChoice: ["cancel", { option: true }],
  dirtyDocumentChoices: [undefined, { option: true }],
  dirtyDocumentDelayMs: [0, { option: true }],
  documentCrashChoice: ["reopen", { option: true }],
  allowRendererDialogs: [false, { option: true }],

  testRoot: async ({}, use) => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-e2e-"));

    try {
      await use(testRoot);
    } finally {
      await fs.promises.rm(testRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },

  saveShiftPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "saved.shift"));
  },

  saveAsShiftPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "saved-as.shift"));
  },

  copyShiftPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "copied.shift"));
  },

  exportTtfPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "exported.ttf"));
  },

  electronProcesses: async ({ testRoot: _testRoot }, use, testInfo) => {
    // Depends on testRoot so every process exits before its directory is removed.
    const processes = new ElectronProcesses();
    try {
      await use(processes);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await processes.attachDiagnostics(testInfo);
      }
      await processes.terminateAll();
    }
  },

  electronApp: async (
    {
      electronProcesses,
      startupFontPath,
      windowSizing,
      deviceScaleFactor,
      electronArgs,
      scriptedDialogs,
      openFontPath,
      saveShiftPaths,
      dirtyDocumentChoice,
      dirtyDocumentChoices,
      dirtyDocumentDelayMs,
      documentCrashChoice,
      testRoot,
      saveShiftPath,
      exportTtfPath,
      sharedWorkspace,
      sharedWorkspaceApp,
    },
    use,
    testInfo,
  ) => {
    if (sharedWorkspace) {
      if (startupFontPath !== FONTS.mutatorSansTtf || scriptedDialogs || electronArgs.length > 0) {
        throw new Error("sharedWorkspace needs the default MutatorSans workspace fixture.");
      }
      const { app, processes } = await sharedWorkspaceApp();
      await resetSharedWorkspace(app);
      try {
        await use(app);
      } finally {
        if (testInfo.status !== testInfo.expectedStatus)
          await processes.attachDiagnostics(testInfo);
      }
      await expectSharedWorkspaceClean(app);
      return;
    }

    const workspacePath = startupFontPath
      ? createAuthoredDocument(startupFontPath, path.join(testRoot, "workspace"))
      : undefined;
    const environment = shiftTestEnvironment();

    if (scriptedDialogs) {
      environment.SHIFT_E2E_NATIVE_DIALOGS = "1";
      environment.SHIFT_E2E_SAVE_SHIFT_PATH = saveShiftPath;
      if (saveShiftPaths) {
        environment.SHIFT_E2E_SAVE_SHIFT_PATHS = JSON.stringify(saveShiftPaths);
      }
      environment.SHIFT_E2E_EXPORT_TTF_PATH = exportTtfPath;
      environment.SHIFT_E2E_DIRTY_DOCUMENT_CHOICE = dirtyDocumentChoice;
      if (dirtyDocumentChoices) {
        environment.SHIFT_E2E_DIRTY_DOCUMENT_CHOICES = dirtyDocumentChoices.join(",");
      }
      if (dirtyDocumentDelayMs > 0) {
        environment.SHIFT_E2E_DIRTY_DOCUMENT_DELAY_MS = String(dirtyDocumentDelayMs);
      }
      if (openFontPath) environment.SHIFT_E2E_OPEN_FONT_PATH = openFontPath;
      environment.SHIFT_E2E_DOCUMENT_CRASH_CHOICE = documentCrashChoice;
    }

    const app = await electronProcesses.launch({
      label: "initial",
      userDataDir: path.join(testRoot, "user-data"),
      args: [...electronArgs, ...(workspacePath ? [workspacePath] : [])],
      env: environment,
      windowSizing,
      deviceScaleFactor,
    });
    await use(app);
  },

  relaunch: async (
    { electronProcesses, testRoot, saveShiftPath, windowSizing, deviceScaleFactor },
    use,
  ) => {
    let launches = 0;
    await use(async (options = { args: [] }) => {
      launches += 1;
      return electronProcesses.launch({
        label: `relaunch-${launches}`,
        userDataDir: path.join(testRoot, "user-data"),
        args: options.args,
        env: shiftTestEnvironment({
          SHIFT_E2E_NATIVE_DIALOGS: "1",
          SHIFT_E2E_OPEN_FONT_PATH: saveShiftPath,
          SHIFT_E2E_SAVE_SHIFT_PATH: saveShiftPath,
          ...options.env,
        }),
        windowSizing,
        deviceScaleFactor,
      });
    });
  },

  page: async ({ electronApp, allowRendererDialogs }, use, testInfo) => {
    const dialogs: RecordedDialog[] = [];
    const recordDialogs = (observedPage: Page) => {
      observedPage.on("dialog", async (dialog) => {
        dialogs.push({ type: dialog.type(), message: dialog.message() });
        await dialog.dismiss();
      });
    };
    for (const observedPage of electronApp.windows()) recordDialogs(observedPage);
    electronApp.on("window", recordDialogs);

    // Visual tests run several apps at once, so a window rarely holds the OS focus. Emulating
    // page focus keeps focus styling and `document.hasFocus()` as they are in a focused window.
    // Platform tests keep real focus, which they assert.
    const visual = testInfo.project.name === "visual";
    if (visual) {
      // A window can close before its session opens; it then needs no emulation.
      electronApp.on("window", (observedPage) => {
        emulateFocus(observedPage).catch(() => undefined);
      });
    }

    const page = await electronApp.firstWindow();
    if (visual) await emulateFocus(page);
    await page.waitForLoadState("domcontentloaded");

    await use(page);

    // A renderer dialog blocks the window until dismissed; an unexpected one hides a bug.
    if (dialogs.length > 0 && !allowRendererDialogs) {
      throw new Error(`Unexpected renderer dialogs: ${JSON.stringify(dialogs)}`);
    }
  },

  editor: async ({ page, electronApp }, use) => {
    await use(new EditorDriver(page, electronApp));
  },
});

/** Fixture whose native outer-dialog choices are supplied by deterministic E2E paths. */
export const documentTest = test.extend<ShiftOptions>({
  scriptedDialogs: true,
});

/** Real Electron lifecycle fixture for sparse native recovery tests. */
export const recoveryTest = test.extend<{ recoveryApp: RecoveryApp }>({
  recoveryApp: async (
    { electronProcesses, testRoot, windowSizing, deviceScaleFactor, font },
    use,
  ) => {
    const userDataDir = path.join(testRoot, "user-data");
    const documentPath = createAuthoredDocument(
      FONTS.mutatorSansTtf,
      path.join(testRoot, "workspace"),
    );
    let launches = 0;
    const launch = async (openDocument: boolean): Promise<ElectronApplication> => {
      launches += 1;
      return electronProcesses.launch({
        label: launches === 1 ? "initial" : `recovery-${launches - 1}`,
        userDataDir,
        args: [],
        env: shiftTestEnvironment(openDocument ? { SHIFT_E2E_FONT_PATH: documentPath } : {}),
        windowSizing,
        deviceScaleFactor,
      });
    };

    let app = await launch(true);
    let page = await readyWorkspacePage(app);
    await applyFontFixture(page, app, font, false);
    await use({
      page,
      get app() {
        return app;
      },
      get editor() {
        return new EditorDriver(page, app);
      },
      documentPath,
      crashAndRecover: async () => {
        await killApp(app);
        app = await launch(false);
        page = await readyWorkspacePage(app);
        return page;
      },
      crashAndRecoverWindow: async (persistedText) => {
        // Chromium writes renderer storage to disk in batches, and a flush only starts the
        // write. Wait until the text is on disk, as if the user had lingered, so the test
        // checks reopen behavior rather than racing that write.
        // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main, not the renderer
        await app.evaluate(({ session }) => session.defaultSession.flushStorageData());
        await expect.poll(() => localStorageOnDiskContains(userDataDir, persistedText)).toBe(true);
        await killApp(app);
        app = await launch(false);
        page = await app.firstWindow();
        await page.waitForLoadState("domcontentloaded");
        return page;
      },
      crashAndReopenDocument: async () => {
        await killApp(app);
        app = await launch(true);
        page = await readyWorkspacePage(app);
        return page;
      },
      canonicalGlyphNames: () => readCanonicalGlyphNames(documentPath, testRoot),
      canonicalVariableFont: () => readCanonicalVariableFont(documentPath, testRoot),
    });
  },
});

/** Workspace fixture that starts directly with MutatorSans instead of visiting the launcher. */
export const workspaceTest = test.extend<ShiftOptions>({
  startupFontPath: FONTS.mutatorSansTtf,

  page: async ({ page, electronApp, font, sharedWorkspace }, use) => {
    await waitForWorkspaceReady(page);
    await applyFontFixture(page, electronApp, font, sharedWorkspace);
    await use(page);
  },
});

/** Authored workspace fixture with deterministic native dialog destinations. */
export const documentWorkspaceTest = documentTest.extend<ShiftOptions>({
  startupFontPath: FONTS.mutatorSansTtf,

  page: async ({ page, electronApp, font, sharedWorkspace }, use) => {
    await waitForWorkspaceReady(page);
    await applyFontFixture(page, electronApp, font, sharedWorkspace);
    await use(page);
  },
});

/** Builds the `font` option into the ready workspace in `page`, when the test sets one. */
async function applyFontFixture(
  page: Page,
  electronApp: ElectronApplication,
  font: FontFixture | undefined,
  sharedWorkspace: boolean,
): Promise<void> {
  if (!font) return;
  if (sharedWorkspace)
    throw new Error("The `font` option edits the document; drop `sharedWorkspace`.");
  if (font.mode !== undefined) {
    throw new Error("The `font` option builds into the launched workspace; it has no `mode`.");
  }
  await buildFontFixture(page, electronApp, font);
}

/** Makes `page` render and report focus as if its window held the OS focus. */
async function emulateFocus(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
}

/**
 * Returns a shared workspace app to a freshly opened state.
 *
 * @remarks
 * The document stays open in the workspace process; reloading the renderer on the home route
 * with cleared storage and no `config.toml` drops the previous test's tool, selection, camera,
 * layout, and theme.
 * The `page` fixture then waits for the workspace to be ready again.
 */
async function resetSharedWorkspace(app: ElectronApplication): Promise<void> {
  const windows = app.windows();
  if (windows.length !== 1) {
    throw new Error(`A shared workspace must have one window; it has ${windows.length}.`);
  }
  const page = windows[0]!;
  // config.toml and themes/ outlive a reload, so a theme from one test would leak into the next.
  const { directory } = await hooksOf(page).session.configState();
  fs.rmSync(path.join(directory, "config.toml"), { force: true });
  fs.rmSync(path.join(directory, "themes"), { recursive: true, force: true });
  await expect
    .poll(async () => {
      const state = await hooksOf(page).session.configState();
      return state.exists || state.themes.length > 0;
    })
    .toBe(false);
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- resets page storage and the route, not app state
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = "#/home";
  });
  await page.reload();
}

/**
 * Fails a test that edited the shared document, since every later test would inherit the edit.
 */
async function expectSharedWorkspaceClean(app: ElectronApplication): Promise<void> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main, not the renderer
  const titles = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => window.getTitle()),
  );
  if (titles.some((title) => title.includes(" *"))) {
    throw new Error(
      "This test edited the shared workspace document. Remove `sharedWorkspace` from its describe.",
    );
  }
}

/** The platform, architecture and versions the running app reports from main. */
export async function appRuntime(app: ElectronApplication): Promise<{
  platform: NodeJS.Platform;
  architecture: string;
  electronVersion: string;
  appVersion: string;
}> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main, not the renderer
  return app.evaluate(({ app: electronApp }) => ({
    platform: process.platform,
    architecture: process.arch,
    electronVersion: process.versions.electron,
    appVersion: electronApp.getVersion(),
  }));
}

/** The platform the renderer's host bridge reports to the page. */
export async function rendererHostPlatform(page: Page): Promise<string | undefined> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads the preload bridge's platform, in windows (the launcher) with no font session to serve E2E hooks
  return page.evaluate(() => window.shiftHost?.platform);
}

/**
 * Waits until an authored workspace has published its loaded font and catalog.
 *
 * @param page - workspace window whose renderer state must settle.
 */
export async function waitForWorkspaceReady(page: Page): Promise<void> {
  await page.waitForURL(/#\/home/, { timeout: 20_000 });
  await expect.poll(() => hooksOf(page).session.workspaceLoaded(), { timeout: 20_000 }).toBe(true);
  await page.getByLabel("Glyph catalog", { exact: true }).waitFor({ state: "visible" });
}

async function readyWorkspacePage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await waitForWorkspaceReady(page);
  return page;
}

function readCanonicalGlyphNames(documentPath: string, testRoot: string): string[] {
  const bridge = createBridge();
  const recoveryPath = path.join(testRoot, `${crypto.randomUUID()}.recovery.sqlite`);
  bridge.openDocument(documentPath, recoveryPath);
  try {
    return bridge.getGlyphs().map((glyph) => glyph.name);
  } finally {
    bridge.closeWorkspace();
    fs.rmSync(recoveryPath, { force: true });
  }
}

function readCanonicalVariableFont(documentPath: string, testRoot: string): CanonicalVariableFont {
  const bridge = createBridge();
  const recoveryPath = path.join(testRoot, `${crypto.randomUUID()}.recovery.sqlite`);
  bridge.openDocument(documentPath, recoveryPath);
  try {
    return {
      axes: bridge.getAxes(),
      sources: bridge.getSources(),
      namedInstances: bridge.getNamedInstances(),
    };
  } finally {
    bridge.closeWorkspace();
    fs.rmSync(recoveryPath, { force: true });
  }
}

/**
 * Navigate to the editor for Unicode codepoint (hex, e.g. "41" = A).
 * Assumes a font is already loaded.
 */
export async function navigateToEditor(page: Page, hexCodepoint: string): Promise<void> {
  await new EditorDriver(page).openGlyphByUnicode(hexCodepoint);
}

export { expect };

function localStorageOnDiskContains(userDataDir: string, text: string): boolean {
  const directory = path.join(userDataDir, "Local Storage", "leveldb");
  if (!fs.existsSync(directory)) return false;

  return fs
    .readdirSync(directory)
    .some((file) => fs.readFileSync(path.join(directory, file)).includes(text));
}
