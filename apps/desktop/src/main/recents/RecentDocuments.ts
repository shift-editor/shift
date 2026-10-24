import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RecentDocument, RecentDocumentVisit } from "../../shared/recents";
import type { Specimen } from "../../shared/workspace/protocol";
import { RecentList, type RecentListRules } from "@shift/types";
import { z } from "zod";
import { parseEach } from "../../shared/parseEach";

/** Most files kept in recents; older opens fall off the end. */
export const RECENT_DOCUMENTS_LIMIT = 20;

/**
 * Revision of the specimen choice rules. Bump it when they change so cached
 * thumbnails built under older rules are rebuilt on next open.
 */
const SPECIMEN_REVISION = 1;

/**
 * A built specimen and the file modification time it was built from. The
 * specimen and revision are not checked beyond being present as stored, and
 * unknown fields are kept, so a list written by another version reads back as
 * it was.
 */
const thumbnailSchema = z.looseObject({
  specimen: z.custom<Specimen | null>((value) => typeof value === "object"),
  modifiedAt: z.number(),
  revision: z.custom<number | undefined>(() => true).optional(),
});

type Thumbnail = z.output<typeof thumbnailSchema>;

const recentEntrySchema = z.looseObject({
  path: z.string(),
  documentId: z.string().nullable(),
  openedAt: z.number(),
  thumbnail: thumbnailSchema.optional(),
  /** Set while the document is open; still set at launch only if Shift did not quit normally. */
  open: z.literal(true).optional(),
});

type RecentEntry = z.output<typeof recentEntrySchema>;

/**
 * One entry per document, newest first, at most {@link RECENT_DOCUMENTS_LIMIT}.
 * An entry is the same document as a visit by path, or by `DocumentId` when the
 * visit has one, so a moved `.shift` document replaces its old entry.
 */
const RECENT_RULES: RecentListRules<RecentEntry, RecentDocumentVisit> = {
  matches: (entry, visit) =>
    entry.path === visit.path ||
    (visit.documentId !== null && entry.documentId === visit.documentId),
  usedAt: (entry) => entry.openedAt,
  limit: RECENT_DOCUMENTS_LIMIT,
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
  #entries: RecentList<RecentEntry, RecentDocumentVisit>;

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
    return this.#entries.items.map((entry) => {
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
    const entry = this.#entries.find(visit);
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
    const entry = this.#entries.find(visit);
    const modifiedAt = modificationTime(visit.path);
    if (!entry || modifiedAt === null) return;

    this.#entries = this.#entries.update(visit, (candidate) => ({
      ...candidate,
      thumbnail: { specimen, modifiedAt, revision: SPECIMEN_REVISION },
    }));
    this.#changed();
  }

  /**
   * Moves a file to the front of recents.
   *
   * @param visit - Opened path plus its `DocumentId`, when it has one.
   * @param openedAt - Epoch milliseconds of the open.
   */
  record(visit: RecentDocumentVisit, openedAt: number = Date.now()): void {
    this.#entries = this.#entries.touch(visit, (previous) => ({
      ...previous,
      path: visit.path,
      documentId: visit.documentId,
      openedAt,
    }));
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

    // By path alone: a query without a DocumentId matches no entry by id.
    this.#entries = this.#entries.remove({ path: filePath, documentId: null });
    this.#changed();
    return removed;
  }

  /**
   * Puts a removed entry back in its original time order.
   *
   * @param document - Entry previously returned by {@link remove}.
   */
  restore(document: RecentDocument): void {
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
    // Placing by openedAt puts it back in its original time order.
    this.#entries = this.#entries.touch(document, () => restored);
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
    const entry = this.#entries.find(visit);
    if (!entry || (entry.open === true) === open) return;

    this.#entries = this.#entries.update(visit, (candidate) => {
      const { open: _open, ...closed } = candidate;
      return open ? { ...closed, open: true } : closed;
    });
    writeEntries(this.#filePath, this.#entries.items);
  }

  /** Records that no file is open, as after a normal quit. */
  clearOpen(): void {
    if (this.#entries.where((entry) => entry.open === true).length === 0) return;

    this.#entries = this.#entries.map(({ open: _open, ...entry }) => entry);
    writeEntries(this.#filePath, this.#entries.items);
  }

  /**
   * Returns the files still open when Shift last stopped and clears every mark.
   *
   * @returns open files, newest first; empty after a normal quit.
   */
  takeOpen(): RecentDocumentVisit[] {
    const open = this.#entries.where((entry) => entry.open === true);
    this.clearOpen();
    return open.map((entry) => ({ path: entry.path, documentId: entry.documentId }));
  }

  /** Removes every entry. */
  clear(): void {
    if (this.#entries.isEmpty) return;

    this.#entries = RecentList.of([], RECENT_RULES);
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
    writeEntries(this.#filePath, this.#entries.items);
    for (const listener of this.#listeners) listener();
  }
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

function readEntries(filePath: string): RecentList<RecentEntry, RecentDocumentVisit> {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return RecentList.of([], RECENT_RULES);
  }

  return RecentList.of(parseEach(recentEntrySchema, text), RECENT_RULES);
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
