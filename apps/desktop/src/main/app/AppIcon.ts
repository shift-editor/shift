import { app } from "electron";
import path from "node:path";
import { shiftDistribution } from "../release";

const iconName = shiftDistribution === "nightly" ? "nightly" : "icon";

/** Applies the distribution-aware development icon to runtime shell features. */
export class AppIcon {
  /**
   * Applies the development icon to macOS Dock when available.
   *
   * Packaged applications use their Icon Composer asset on macOS 26 and
   * their ICNS icon on earlier macOS releases.
   */
  install(): void {
    if (process.platform !== "darwin" || app.isPackaged) return;

    app.dock?.setIcon(path.resolve(process.cwd(), "../../icons", `${iconName}-macos.png`));
  }
}
