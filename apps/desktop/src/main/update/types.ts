import type { AppLifecycle } from "../app/AppLifecycle";
import type { ShiftLogger } from "../logging";
import type { Window } from "../windows/Window";

export type UpdateTrigger = "automatic" | "manual";

export type UpdateStatus =
  | { type: "idle" }
  | { type: "checking"; trigger: UpdateTrigger }
  | { type: "available"; version: string }
  | { type: "downloading"; version: string }
  | { type: "ready"; version: string }
  | { type: "restarting" };

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
  log: ShiftLogger;
};
