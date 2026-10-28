import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type { ShiftOptions } from "./types";

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 600;

/**
 * Waits for a visible window, normalizing renderer geometry only for visual baselines.
 *
 * @param app - running application that owns the page.
 * @param page - renderer whose owning native window is prepared.
 * @param windowSizing - native preserves application geometry; visual requests 1200×600 CSS pixels.
 * @throws {Error} when window visibility or the requested visual dimensions do not settle.
 */
export async function prepareWindow(
  app: ElectronApplication,
  page: Page,
  windowSizing: ShiftOptions["windowSizing"],
): Promise<void> {
  const browserWindow = await app.browserWindow(page);

  try {
    await expect
      .poll(() => browserWindow.evaluate((window) => window.isVisible()), { timeout: 20_000 })
      .toBe(true);
    await page.waitForLoadState("domcontentloaded");

    if (windowSizing === "native") return;

    // A window opened while the app runs can still be settling into a maximized, screen-sized
    // frame and override a size applied once, so reapply it until the renderer reports it.
    await expect
      .poll(
        async () => {
          await browserWindow.evaluate(
            (win, { w, h }) => {
              if (win.isMaximized()) win.unmaximize();
              // Hosted displays can be narrower than the deterministic snapshot size.
              win.setMinimumSize(w, h);
              win.setContentSize(w, h);
              win.center();
            },
            { w: WINDOW_WIDTH, h: WINDOW_HEIGHT },
          );
          // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron windows and the page viewport, not app state
          return page.evaluate(() => [window.innerWidth, window.innerHeight]);
        },
        { timeout: 30_000 },
      )
      .toEqual([WINDOW_WIDTH, WINDOW_HEIGHT]);
  } finally {
    await browserWindow.dispose();
  }
}

/**
 * Collects native and renderer geometry without letting an unavailable process hide other evidence.
 *
 * @param app - application to inspect before its test process is terminated.
 * @returns independent diagnostic lines, including errors for unavailable windows or processes.
 */
export async function collectWindowDiagnostics(app: ElectronApplication): Promise<string[]> {
  const diagnostics: string[] = [];

  try {
    // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron windows and the page viewport, not app state
    const windows = await app.evaluate(({ BrowserWindow, screen }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        id: window.id,
        title: window.getTitle(),
        url: window.webContents.getURL(),
        bounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
        visible: window.isVisible(),
        maximized: window.isMaximized(),
        minimized: window.isMinimized(),
        zoomFactor: window.webContents.getZoomFactor(),
        display: screen.getDisplayMatching(window.getBounds()),
      })),
    );
    diagnostics.push(`native windows: ${JSON.stringify(windows)}`);
  } catch (error) {
    diagnostics.push(`native windows unavailable: ${String(error)}`);
  }

  for (const [index, page] of app.windows().entries()) {
    try {
      // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron windows and the page viewport, not app state
      const viewport = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        visibility: document.visibilityState,
      }));
      diagnostics.push(`renderer ${index}: ${JSON.stringify(viewport)}`);
    } catch (error) {
      diagnostics.push(`renderer ${index} unavailable: ${String(error)}`);
    }
  }

  return diagnostics;
}

/** The primary display's work area, the screen space windows open into, in main's units. */
export async function primaryWorkArea(
  app: ElectronApplication,
): Promise<{ x: number; y: number; width: number; height: number }> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron windows and the page viewport, not app state
  return app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
}

/** The device pixels per CSS pixel the page renders at. */
export async function devicePixelRatio(page: Page): Promise<number> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron windows and the page viewport, not app state
  return page.evaluate(() => window.devicePixelRatio);
}

/** Grows the app's first window's content area by `delta` CSS pixels in width, as a user resize does. */
export async function resizeWindowContent(app: ElectronApplication, delta: number): Promise<void> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads Electron windows and the page viewport, not app state
  await app.evaluate(({ BrowserWindow }, change) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const [width, height] = window.getContentSize();
    window.setContentSize(width! + change, height!);
  }, delta);
}
