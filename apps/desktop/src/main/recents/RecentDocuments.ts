import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RecentDocument, RecentDocumentVisit } from "../../shared/recents";
import type { Specimen } from "../../shared/workspace/protocol";

/** Most files kept in recents; older opens fall off the end. */
export const RECENT_DOCUMENTS_LIMIT = 20;

/**
 * Revision of the specimen choice rules. Bump it when they change so cached
 * thumbnails built under older rules are rebuilt on next open.
 */
const SPECIMEN_REVISION = 1;

/** A built specimen and the file modification time it was built from. */
type Thumbnail = {
  specimen: Specimen | null;
  modifiedAt: number;
  revision?: number;
};

type RecentEntry = {
  path: string;
  documentId: string | null;
  openedAt: number;
  thumbnail?: Thumbnail;
  /** Set while the document is open; still set at launch only if Shift did not quit normally. */
  open?: true;
};

/**
 * Main-owned list of files Shift has opened, newest first.
 *
 * @remarks
 * Entries are keyed by `DocumentId` when the file is a native `.shift`
 * document, so a moved or renamed document replaces its old entry, and by
 * canonical path otherwise. The list persists as JSON after every change; an
 * unreadable file starts an empty list rather than failing app startup.
 *
 * Each entry may cache the thumbnail specimen built for it. A `.shift`
 * document's specimen stays valid until Shift replaces it; any other file's
 * specimen is dropped once the file's modification time changes.
 */
export class RecentDocuments {
  readonly #filePath: string;
  readonly #homeDirectory: string;
  readonly #listeners = new Set<() => void>();
  #entries: RecentEntry[];

  /**
   * Loads recents persisted at `filePath`.
   *
   * @param filePath - JSON file that stores the list across launches.
   */
  constructor(filePath: string, homeDirectory: string = os.homedir()) {
    this.#filePath = filePath;
    this.#homeDirectory = homeDirectory;
    this.#entries = readEntries(filePath);
  }

  /**
   * Returns every recent file, newest first, with a fresh existence check.
   *
   * @returns a new array; mutating it does not change the store.
   */
  list(): RecentDocument[] {
    return this.#entries.map((entry) => {
      const modifiedAt = modificationTime(entry.path);
      return {
        path: entry.path,
        documentId: entry.documentId,
        openedAt: entry.openedAt,
        location: displayLocation(entry.path, this.#homeDirectory),
        missing: modifiedAt === null,
        specimen: currentThumbnail(entry, modifiedAt)?.specimen ?? null,
      };
    });
  }

  /**
   * Checks whether a file lacks a current thumbnail specimen.
   *
   * @param visit - File to check; it need not be in recents.
   */
  needsSpecimen(visit: RecentDocumentVisit): boolean {
    const entry = this.#entries.find((candidate) => sameDocument(candidate, visit));
    if (!entry) return false;

    return currentThumbnail(entry, modificationTime(entry.path)) === null;
  }

  /**
   * Caches the thumbnail specimen built for a recent file.
   *
   * @param visit - File the specimen was built from; ignored when it left recents meanwhile.
   * @param specimen - Built specimen, or null when the font draws nothing usable.
   */
  setSpecimen(visit: RecentDocumentVisit, specimen: Specimen | null): void {
    const entry = this.#entries.find((candidate) => sameDocument(candidate, visit));
    const modifiedAt = modificationTime(visit.path);
    if (!entry || modifiedAt === null) return;

    this.#entries = this.#entries.map((candidate) =>
      candidate === entry
        ? { ...candidate, thumbnail: { specimen, modifiedAt, revision: SPECIMEN_REVISION } }
        : candidate,
    );
    this.#changed();
  }

  /**
   * Moves a file to the front of recents.
   *
   * @param visit - Opened path plus its `DocumentId`, when it has one.
   * @param openedAt - Epoch milliseconds of the open.
   */
  record(visit: RecentDocumentVisit, openedAt: number = Date.now()): void {
    const previous = this.#entries.find((entry) => sameDocument(entry, visit));
    const remaining = this.#entries.filter((entry) => !sameDocument(entry, visit));
    const recorded: RecentEntry = {
      ...previous,
      path: visit.path,
      documentId: visit.documentId,
      openedAt,
    };

    this.#entries = [recorded, ...remaining].slice(0, RECENT_DOCUMENTS_LIMIT);
    this.#changed();
  }

  /**
   * Removes one file from recents.
   *
   * @param filePath - Path of the entry to remove.
   * @returns the removed entry, or null when no entry has that path.
   */
  remove(filePath: string): RecentDocument | null {
    const removed = this.list().find((entry) => entry.path === filePath) ?? null;
    if (!removed) return null;

    this.#entries = this.#entries.filter((entry) => entry.path !== filePath);
    this.#changed();
    return removed;
  }

  /**
   * Puts a removed entry back in its original time order.
   *
   * @param document - Entry previously returned by {@link remove}.
   */
  restore(document: RecentDocument): void {
    const remaining = this.#entries.filter((entry) => !sameDocument(entry, document));
    const restored: RecentEntry = {
      path: document.path,
      documentId: document.documentId,
      openedAt: document.openedAt,
    };
    const modifiedAt = modificationTime(document.path);
    if (document.specimen && modifiedAt !== null) {
      restored.thumbnail = {
        specimen: document.specimen,
        modifiedAt,
        revision: SPECIMEN_REVISION,
      };
    }
    this.#entries = [...remaining, restored]
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, RECENT_DOCUMENTS_LIMIT);
    this.#changed();
  }

  /**
   * Records whether a recent file is open, so files open when Shift stops unexpectedly
   * reopen on the next launch.
   *
   * @param visit - File whose session opened or ended; ignored when it is not in recents.
   * @param open - Whether the file is now open.
   */
  setOpen(visit: RecentDocumentVisit, open: boolean): void {
    const entry = this.#entries.find((candidate) => sameDocument(candidate, visit));
    if (!entry || (entry.open === true) === open) return;

    const { open: _open, ...closed } = entry;
    const updated: RecentEntry = open ? { ...closed, open: true } : closed;
    this.#entries = this.#entries.map((candidate) => (candidate === entry ? updated : candidate));
    writeEntries(this.#filePath, this.#entries);
  }

  /** Records that no file is open, as after a normal quit. */
  clearOpen(): void {
    if (!this.#entries.some((entry) => entry.open)) return;

    this.#entries = this.#entries.map(({ open: _open, ...entry }) => entry);
    writeEntries(this.#filePath, this.#entries);
  }

  /**
   * Returns the files still open when Shift last stopped and clears every mark.
   *
   * @returns open files, newest first; empty after a normal quit.
   */
  takeOpen(): RecentDocumentVisit[] {
    const open = this.#entries.filter((entry) => entry.open);
    this.clearOpen();
    return open.map((entry) => ({ path: entry.path, documentId: entry.documentId }));
  }

  /** Removes every entry. */
  clear(): void {
    if (this.#entries.length === 0) return;

    this.#entries = [];
    this.#changed();
  }

  /**
   * Subscribes to list changes.
   *
   * @param listener - Called after each change has been persisted.
   * @returns a function that removes this listener.
   */
  onChanged(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #changed(): void {
    writeEntries(this.#filePath, this.#entries);
    for (const listener of this.#listeners) listener();
  }
}

function sameDocument(entry: RecentEntry, visit: RecentDocumentVisit): boolean {
  if (entry.path === visit.path) return true;
  return visit.documentId !== null && entry.documentId === visit.documentId;
}

/** Returns the file's folder with a leading home directory shortened to `~`. */
function displayLocation(filePath: string, homeDirectory: string): string {
  const folder = path.dirname(filePath);
  if (folder === homeDirectory) return "~";
  if (folder.startsWith(homeDirectory + path.sep)) {
    return `~${folder.slice(homeDirectory.length)}`;
  }
  return folder;
}

function modificationTime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function currentThumbnail(entry: RecentEntry, modifiedAt: number | null): Thumbnail | null {
  const thumbnail = entry.thumbnail;
  if (!thumbnail || modifiedAt === null) return null;
  if (thumbnail.revision !== SPECIMEN_REVISION) return null;
  if (entry.documentId !== null) return thumbnail;

  return thumbnail.modifiedAt === modifiedAt ? thumbnail : null;
}

function readEntries(filePath: string): RecentEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecentEntry).slice(0, RECENT_DOCUMENTS_LIMIT);
}

function writeEntries(filePath: string, entries: readonly RecentEntry[]): void {
  const temporaryPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(entries, null, 2));
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    console.warn("failed to persist recent documents", error);
  }
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== "object" || value === null) return false;

  const entry = value as Record<string, unknown>;
  const documentIdValid = entry.documentId === null || typeof entry.documentId === "string";
  const thumbnailValid = entry.thumbnail === undefined || isThumbnail(entry.thumbnail);
  const openValid = entry.open === undefined || entry.open === true;
  return (
    typeof entry.path === "string" &&
    typeof entry.openedAt === "number" &&
    documentIdValid &&
    thumbnailValid &&
    openValid
  );
}

function isThumbnail(value: unknown): value is Thumbnail {
  if (typeof value !== "object" || value === null) return false;

  const thumbnail = value as Record<string, unknown>;
  return typeof thumbnail.modifiedAt === "number" && typeof thumbnail.specimen === "object";
}
