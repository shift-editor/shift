import type { UpdateEvent, UpdateState } from "./types";

/** Returns the next legal update state, or `null` for an illegal or stale event. */
export function nextUpdateState(state: UpdateState, event: UpdateEvent): UpdateState | null {
  switch (event.type) {
    case "checkRequested":
      switch (state.type) {
        case "idle":
        case "current":
        case "failed":
          return { type: "checking", trigger: event.trigger };
        default:
          return null;
      }
    case "noUpdateAvailable":
      if (state.type !== "checking") return null;
      return { type: "current", checkedAt: event.checkedAt };
    case "updateAvailable":
      if (state.type !== "checking") return null;
      return { type: "downloading", trigger: state.trigger, update: event.update };
    case "updateDownloaded":
      if (state.type !== "downloading") return null;
      return { type: "ready", update: state.update };
    case "operationFailed":
      if (state.type === "checking" && event.phase === "check") {
        return {
          type: "failed",
          phase: event.phase,
          trigger: state.trigger,
          message: event.message,
        };
      }

      if (state.type === "downloading" && event.phase === "download") {
        return {
          type: "failed",
          phase: event.phase,
          trigger: state.trigger,
          message: event.message,
        };
      }

      return null;
    case "restartRequested":
      if (state.type !== "ready") return null;
      return { type: "restarting", update: state.update };
    case "restartRejected":
      if (state.type !== "restarting") return null;
      return { type: "ready", update: state.update };
  }
}
