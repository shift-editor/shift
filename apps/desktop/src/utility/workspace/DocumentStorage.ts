import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DraftAllocation } from "./types";

/**
 * Allocates working-store locations under the utility-owned documents root.
 *
 * @remarks
 * Moved from main: the utility process owns everything durable, so document
 * ids are minted and store paths allocated here. Drafts are RETAINED across
 * restarts — an authored font must never die with the process (the
 * data-loss class three ADRs were written against). Reopen/resume UX and
 * pruning land with the durability series.
 */
export class DocumentStorage {
  readonly #rootPath: string;
  readonly #createId: () => string;

  constructor(rootPath: string, createId = () => crypto.randomUUID()) {
    this.#rootPath = rootPath;
    this.#createId = createId;
  }

  /** Mints a document id and allocates its draft store directory on disk. */
  createDraft(): DraftAllocation {
    const documentId = this.#createId();
    const directoryPath = path.join(this.#rootPath, "drafts", documentId);

    fs.mkdirSync(directoryPath, { recursive: true });

    return {
      documentId,
      storePath: path.join(directoryPath, "document.sqlite"),
    };
  }

  /** Lists retained draft stores that can be inspected for recovery. */
  listDrafts(): DraftAllocation[] {
    const draftsRoot = path.join(this.#rootPath, "drafts");
    if (!fs.existsSync(draftsRoot)) return [];

    const drafts: DraftAllocation[] = [];
    for (const entry of fs.readdirSync(draftsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const storePath = path.join(draftsRoot, entry.name, "document.sqlite");
      if (!fs.existsSync(storePath)) continue;

      drafts.push({
        documentId: entry.name,
        storePath,
      });
    }

    return drafts;
  }
}
