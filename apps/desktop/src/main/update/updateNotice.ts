import type { UpdateNotice } from "../../shared/update/types";
import type { UpdateStatus } from "./types";

const HIDDEN: UpdateNotice = { type: "hidden" };

/**
 * What the update strip shows for an updater status.
 *
 * @param status - the updater's current state.
 * @param putOff - whether the user chose Later for the update this status is about.
 */
export function updateNotice(status: UpdateStatus, putOff: boolean): UpdateNotice {
  switch (status.type) {
    case "idle":
    case "checking":
    case "restarting":
      return HIDDEN;
    case "available":
      return putOff ? HIDDEN : { type: "available", version: status.version };
    case "downloading":
      return { type: "downloading", version: status.version, percent: status.percent };
    case "ready":
      return putOff ? HIDDEN : { type: "ready", version: status.version };
  }
}

/** Whether two notices draw the same strip; progress counts in whole percent. */
export function sameNotice(a: UpdateNotice, b: UpdateNotice): boolean {
  if (a.type === "downloading" && b.type === "downloading") {
    return a.version === b.version && Math.floor(a.percent) === Math.floor(b.percent);
  }
  if (a.type === "hidden" || b.type === "hidden") return a.type === b.type;

  return a.type === b.type && a.version === b.version;
}
