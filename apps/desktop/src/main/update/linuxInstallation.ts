import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import type { LinuxInstallation } from "./types";

/**
 * Classifies the running Linux build.
 *
 * Replacing an AppImage deletes and recreates its file, so the directory, not
 * the file, must be writable. electron-builder marks DEB and RPM installs with a
 * `package-type` file in the resources directory.
 *
 * @param appImagePath - `process.env.APPIMAGE`, set by the AppImage runtime.
 * @param resourcesPath - `process.resourcesPath` of the packaged application.
 * @returns null for builds that are neither, such as an unpacked directory.
 */
export function detectLinuxInstallation(
  appImagePath: string | undefined,
  resourcesPath: string,
): LinuxInstallation | null {
  if (appImagePath && path.isAbsolute(appImagePath)) {
    return isWritableDirectory(path.dirname(appImagePath)) ? "appImage" : "readOnlyAppImage";
  }

  if (existsSync(path.join(resourcesPath, "package-type"))) return "systemPackage";

  return null;
}

function isWritableDirectory(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
