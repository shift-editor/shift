import type { AppLifecycle } from "../app/AppLifecycle";
import type { ShiftLogger } from "../logging";
import type { Window } from "../windows/Window";
import type { UpdateNotice } from "../../shared/update/types";

export type UpdateTrigger = "automatic" | "manual";

export type UpdateStatus =
  | { type: "idle" }
  | { type: "checking"; trigger: UpdateTrigger }
  | { type: "available"; version: string }
  | { type: "downloading"; version: string; percent: number }
  | { type: "ready"; version: string }
  | { type: "restarting" };

/** What a backend reports back to `AppUpdater` as a check or download runs. */
export type UpdateBackendEvents = {
  available: (version: string) => void;
  notAvailable: () => void;
  /** Cumulative download progress, 0–100. */
  progress: (percent: number) => void;
  downloaded: () => void;
  error: (error: unknown) => void;
};

/**
 * Finds, downloads and installs updates for `AppUpdater`.
 *
 * @remarks
 * Packaged builds use electron-updater; `pnpm dev` with `SHIFT_SIMULATE_UPDATE=1`
 * uses a simulated backend so the update strip can be tried without a release.
 */
export interface UpdateBackend {
  /** Starts reporting to `events`; called once, before the first check. */
  listen(events: UpdateBackendEvents): void;
  /** Checks for a newer version; the result arrives through the events. */
  check(): Promise<void>;
  /** Downloads the available version; resolves when it finishes or rejects when it fails. */
  download(): Promise<void>;
  /** Quits and installs the downloaded version, relaunching the app. */
  install(): void;
}

export type UpdateFeed = {
  provider: "generic";
  url: string;
};

/**
 * How a Linux build reached the machine, which decides who may replace it.
 *
 * - `appImage`: an AppImage in a directory the user can write, so Shift can replace it.
 * - `readOnlyAppImage`: an AppImage Shift cannot replace, such as one copied into `/opt`.
 * - `systemPackage`: a DEB or RPM install, updated only by the package manager.
 */
export type LinuxInstallation = "appImage" | "readOnlyAppImage" | "systemPackage";

export type UpdateFeedTarget = {
  distribution: "release" | "nightly";
  platform: NodeJS.Platform;
  architecture: NodeJS.Architecture;
  /** Null on macOS and Windows, and for unrecognised Linux builds. */
  linuxInstallation: LinuxInstallation | null;
};

export type AppUpdaterOptions = {
  lifecycle: AppLifecycle;
  activeWindow: () => Window | null;
  /** Sends a changed update notice to every launcher and workspace window. */
  broadcast: (notice: UpdateNotice) => void;
  log: ShiftLogger;
};
