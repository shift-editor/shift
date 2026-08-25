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

export type UpdateFeedTarget = {
  distribution: "release" | "nightly";
  platform: NodeJS.Platform;
  architecture: NodeJS.Architecture;
};

export type AppUpdaterOptions = {
  lifecycle: AppLifecycle;
  activeWindow: () => Window | null;
  log: ShiftLogger;
};
