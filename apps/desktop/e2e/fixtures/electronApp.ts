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
} from "./types";
import { EditorDriver } from "./EditorDriver";
import { ElectronProcesses, killApp } from "./electronProcesses";

export type { CanonicalVariableFont, RecoveryApp } from "./types";
export { killApp, MAIN_JS } from "./electronProcesses";

const APP_ROOT = path.resolve(__dirname, "../..");
export const FONT_PATH = path.resolve(APP_ROOT, "../../fixtures/fonts/mutatorsans/MutatorSans.ttf");
export const OTF_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/mutatorsans/MutatorSans.otf",
);
export const UFO_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo",
);
export const DESIGNSPACE_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);
export const GLYPHS_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/MutatorSansVariable.glyphs",
);
export const GLYPHSPACKAGE_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/PackageFont.glyphspackage",
);

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
export const test = base.extend<ShiftFixtures & ShiftOptions>({
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
    },
    use,
  ) => {
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
    await use(async (options = {}) => {
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

  page: async ({ electronApp, allowRendererDialogs }, use) => {
    const dialogs: RecordedDialog[] = [];
    const recordDialogs = (observedPage: Page) => {
      observedPage.on("dialog", async (dialog) => {
        dialogs.push({ type: dialog.type(), message: dialog.message() });
        await dialog.dismiss();
      });
    };
    for (const observedPage of electronApp.windows()) recordDialogs(observedPage);
    electronApp.on("window", recordDialogs);

    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await use(page);

    // A renderer dialog blocks the window until dismissed; an unexpected one hides a bug.
    if (dialogs.length > 0 && !allowRendererDialogs) {
      throw new Error(`Unexpected renderer dialogs: ${JSON.stringify(dialogs)}`);
    }
  },

  editor: async ({ page }, use) => {
    await use(new EditorDriver(page));
  },
});

/** Fixture whose native outer-dialog choices are supplied by deterministic E2E paths. */
export const documentTest = test.extend<ShiftOptions>({
  scriptedDialogs: true,
});

/** Real Electron lifecycle fixture for sparse native recovery tests. */
export const recoveryTest = test.extend<{ recoveryApp: RecoveryApp }>({
  recoveryApp: async ({ electronProcesses, testRoot, windowSizing, deviceScaleFactor }, use) => {
    const userDataDir = path.join(testRoot, "user-data");
    const documentPath = createAuthoredDocument(FONT_PATH, path.join(testRoot, "workspace"));
    let launches = 0;
    const launch = async (openDocument: boolean): Promise<ElectronApplication> => {
      launches += 1;
      return electronProcesses.launch({
        label: launches === 1 ? "initial" : `recovery-${launches - 1}`,
        userDataDir,
        env: shiftTestEnvironment(openDocument ? { SHIFT_E2E_FONT_PATH: documentPath } : {}),
        windowSizing,
        deviceScaleFactor,
      });
    };

    let app = await launch(true);
    let page = await readyWorkspacePage(app);
    await use({
      page,
      documentPath,
      crashAndRecover: async () => {
        await killApp(app);
        app = await launch(false);
        page = await readyWorkspacePage(app);
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
  startupFontPath: FONT_PATH,

  page: async ({ page }, use) => {
    await waitForWorkspaceReady(page);
    await use(page);
  },
});

/** Authored workspace fixture with deterministic native dialog destinations. */
export const documentWorkspaceTest = documentTest.extend<ShiftOptions>({
  startupFontPath: FONT_PATH,

  page: async ({ page }, use) => {
    await waitForWorkspaceReady(page);
    await use(page);
  },
});

/**
 * Waits until an authored workspace has published its loaded font and catalog.
 *
 * @param page - workspace window whose renderer state must settle.
 */
export async function waitForWorkspaceReady(page: Page): Promise<void> {
  await page.waitForURL(/#\/home/, { timeout: 20_000 });
  await page.waitForFunction(() => window.shift?.font.loaded === true, undefined, {
    timeout: 20_000,
  });
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

export { expect } from "@playwright/test";
