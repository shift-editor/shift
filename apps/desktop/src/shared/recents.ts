import type { Specimen } from "./workspace/protocol";

/** One file Shift has opened, as the launcher and File → Open Recent show it. */
export type RecentDocument = {
  /** Canonical path of the file when it was last opened. */
  path: string;
  /** Native `.shift` identity; null for source and binary fonts. */
  documentId: string | null;
  /** Epoch milliseconds of the most recent open. */
  openedAt: number;
  /** True when nothing exists at `path` any more. */
  missing: boolean;
  /**
   * Cached thumbnail specimen; null when none was built yet, the font draws
   * nothing, or the file changed outside Shift since it was built.
   */
  specimen: Specimen | null;
};

/** A file open that should be recorded in recents. */
export type RecentDocumentVisit = {
  path: string;
  documentId: string | null;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const RELATIVE_DAY_LIMIT = 7;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Returns the final path segment, accepting both separators. */
export function pathBasename(filePath: string): string {
  const segments = pathSegments(filePath);
  return segments[segments.length - 1] ?? filePath;
}

/**
 * Formats when a file was last opened: relative for the past week, then a date.
 *
 * @param openedAt - Epoch milliseconds of the open.
 * @param now - Current epoch milliseconds.
 */
export function recentOpenedLabel(openedAt: number, now: number): string {
  const elapsed = Math.max(0, now - openedAt);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;

  const days = calendarDaysBetween(openedAt, now);
  if (days === 0) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (days === 1) return "yesterday";
  if (days < RELATIVE_DAY_LIMIT) return `${days} days ago`;

  const opened = new Date(openedAt);
  const date = `${opened.getDate()} ${MONTHS[opened.getMonth()]}`;
  const sameYear = opened.getFullYear() === new Date(now).getFullYear();
  return sameYear ? date : `${date} ${opened.getFullYear()}`;
}

/**
 * Finds the parent folder that tells apart recent files sharing a filename.
 *
 * @param paths - Paths of every listed recent file.
 * @returns folder label per path; paths with a unique filename are absent.
 */
export function recentFolderLabels(paths: readonly string[]): Map<string, string> {
  const pathsByName = new Map<string, string[]>();
  for (const filePath of paths) {
    const name = pathBasename(filePath);
    pathsByName.set(name, [...(pathsByName.get(name) ?? []), filePath]);
  }

  const labels = new Map<string, string>();
  for (const group of pathsByName.values()) {
    if (group.length < 2) continue;

    for (const [filePath, label] of distinguishingFolders(group)) labels.set(filePath, label);
  }
  return labels;
}

function distinguishingFolders(group: readonly string[]): Map<string, string> {
  const parents = group.map((filePath) => pathSegments(filePath).slice(0, -1).reverse());
  const depth = Math.max(...parents.map((segments) => segments.length));

  for (let level = 0; level < depth; level++) {
    const folders = parents.map((segments) => segments[level] ?? "");
    if (new Set(folders).size === group.length) {
      return new Map(group.map((filePath, index) => [filePath, folders[index]]));
    }
  }

  return new Map(
    group.map((filePath, index) => [filePath, [...parents[index]].reverse().join("/")]),
  );
}

function pathSegments(filePath: string): string[] {
  return filePath.split(/[\\/]/).filter((segment) => segment.length > 0);
}

function calendarDaysBetween(from: number, to: number): number {
  const start = new Date(from);
  const end = new Date(to);
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endDay - startDay) / (24 * HOUR_MS));
}
