/**
 * What the update strip shows in every launcher and workspace window.
 *
 * - `hidden`: no update, or the user chose Later.
 * - `available`: a version can be downloaded.
 * - `downloading`: the download is under way; `percent` runs 0–100.
 * - `ready`: the download finished and a restart installs it.
 */
export type UpdateNotice =
  | { type: "hidden" }
  | { type: "available"; version: string }
  | { type: "downloading"; version: string; percent: number }
  | { type: "ready"; version: string };

/** A notice the strip draws: every notice but `hidden`. */
export type ShownUpdateNotice = Exclude<UpdateNotice, { type: "hidden" }>;
