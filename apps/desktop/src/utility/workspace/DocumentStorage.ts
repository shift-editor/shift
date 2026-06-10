import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DraftAllocation } from "./types";

/**
 * Allocates working-store locations under the utility-owned documents root.
 *
 * @remarks
 * Moved from main: the utility process owns everything durable, so document
 * ids are minted and store paths allocated here. Drafts are transient by
 * definition; {@link clearDrafts} removes them all on host start.
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

  /** Removes every draft store; drafts must not survive a host restart. */
  clearDrafts(): void {
    fs.rmSync(path.join(this.#rootPath, "drafts"), {
      recursive: true,
      force: true,
    });
  }
}
