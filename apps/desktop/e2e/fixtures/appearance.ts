import type { ElectronApplication, Page } from "@playwright/test";

// Theme setup and checks for the Appearance specs. Writing the theme goes through the host's
// config API, the one Settings › Appearance calls.

/** Selects the theme `themeId` in config.toml, as Settings › Appearance does. */
export async function setTheme(page: Page, themeId: string): Promise<void> {
  await page.evaluate((id) => window.shiftHost!.config.setTheme(id), themeId);
}

/** The directory this build's config.toml lives in, in the test's isolated user data. */
export async function configDirectory(page: Page): Promise<string> {
  const { directory } = await page.evaluate(() => window.shiftHost!.config.state());
  return directory;
}

/** Whether the PNG `png` has any channel darker than 250, decoded by Electron in main. */
export async function imageHasInk(app: ElectronApplication, png: Buffer): Promise<boolean> {
  return app.evaluate(({ nativeImage }, base64) => {
    const bitmap = nativeImage.createFromBuffer(Buffer.from(base64, "base64")).toBitmap();
    return bitmap.some((channel) => channel < 250);
  }, png.toString("base64"));
}
