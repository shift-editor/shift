import { app } from "electron";
import path from "node:path";
import { shiftDistribution } from "../release";

const iconFileName = shiftDistribution === "nightly" ? "nightly.png" : "icon.png";

/**
 * Resolves and applies the app icon used by runtime shell features.
 *
 * @remarks
 * Packaged app icons are owned by electron-builder configuration. This class covers
 * runtime APIs such as the macOS Dock icon during development and About panel
 * fallback icons on platforms that support `iconPath`.
 */
export class AppIcon {
  /**
   * Applies the development icon to macOS Dock when available.
   *
   * Packaged applications use their Icon Composer asset on macOS 26 and
   * their ICNS icon on earlier macOS releases.
   */
  install(): void {
    if (process.platform !== "darwin" || app.isPackaged) return;

    app.dock?.setIcon(this.path());
  }

  /**
   * Returns the PNG icon path available to runtime Electron APIs.
   *
   * @returns the packaged resource path in production, or the repo icon during development.
   */
  path(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, iconFileName);
    }

    return path.resolve(process.cwd(), "../../icons", iconFileName);
  }
}
