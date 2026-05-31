import { app } from "electron";
import path from "node:path";

const iconFileName = "icon.png";

/**
 * Resolves and applies the app icon used by runtime shell features.
 *
 * @remarks
 * Packaged app icons are still owned by Forge configuration. This class covers
 * runtime APIs such as the macOS Dock icon during development and About panel
 * fallback icons on platforms that support `iconPath`.
 */
export class AppIcon {
  /**
   * Applies the runtime icon to macOS Dock when available.
   *
   * Electron's Dock API is macOS-only; other platforms get their taskbar/window
   * icon from packaging and BrowserWindow configuration instead.
   */
  install(): void {
    if (process.platform !== "darwin") return;

    app.dock.setIcon(this.path());
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
