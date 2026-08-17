import type { AutoUpdater } from "electron";
import type { AppLifecycle } from "../app/AppLifecycle";
import type { ShiftLogger } from "../logging";
import type { Window } from "../windows/Window";

export type UpdateTrigger = "automatic" | "manual";
export type UpdatePhase = "check" | "download" | "restart";
export type UpdateDisabledReason = "development" | "unsupported-platform" | "missing-configuration";

export type Update = {
  version: string | null;
};

export type UpdateState =
  | { type: "disabled"; reason: UpdateDisabledReason }
  | { type: "idle" }
  | { type: "checking"; trigger: UpdateTrigger }
  | { type: "current"; checkedAt: string }
  | { type: "downloading"; trigger: UpdateTrigger; update: Update }
  | { type: "ready"; update: Update }
  | { type: "restarting"; update: Update }
  | { type: "failed"; phase: UpdatePhase; trigger: UpdateTrigger; message: string };

export type UpdateEvent =
  | { type: "checkRequested"; trigger: UpdateTrigger }
  | { type: "noUpdateAvailable"; checkedAt: string }
  | { type: "updateAvailable"; update: Update }
  | { type: "updateDownloaded"; update: Update }
  | { type: "operationFailed"; phase: "check" | "download"; message: string }
  | { type: "restartRequested" }
  | { type: "restartRejected" };

export type UpdateFeedTarget = {
  distribution: "release" | "nightly";
  platform: NodeJS.Platform;
  architecture: NodeJS.Architecture;
};

export type AppUpdaterOptions = {
  autoUpdater: AutoUpdater;
  lifecycle: AppLifecycle;
  activeWindow: () => Window | null;
  applicationName: () => string;
  openExternal: (url: string) => Promise<void>;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  architecture: NodeJS.Architecture;
  productVersion: string;
  distribution: "release" | "nightly";
  feedBaseUrl: string;
  log: ShiftLogger;
};
