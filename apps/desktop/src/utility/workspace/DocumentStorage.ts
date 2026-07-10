import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DocumentAllocation, OrphanedDocument, PackageAddress, PackageBinding } from "./types";

const packageBindingSchema = z
  .object({
    packageId: z.string(),
    canonicalPath: z.string(),
    documentId: z.string(),
    storePath: z.string(),
    updatedAt: z.string(),
  })
  .strict();

/**
 * Owns utility-process document allocations and package bindings.
 *
 * @remarks
 * SQLite databases live under `documents/<documentId>`. Package source files
 * are bound to those databases through JSON files under
 * `packages/<packageId>/<pathHash>.json`, so changing a binding is an atomic
 * file replace rather than a database move.
 */
export class DocumentStorage {
  readonly #rootPath: string;
  readonly #createId: () => string;

  constructor(rootPath: string, createId = () => crypto.randomUUID()) {
    this.#rootPath = rootPath;
    this.#createId = createId;
  }

  /**
   * Mints a document id and creates its SQLite directory.
   *
   * @returns a fresh allocation owned by the caller.
   */
  createDocument(): DocumentAllocation {
    const documentId = this.#createId();
    const allocation = this.document(documentId);

    fs.mkdirSync(path.dirname(allocation.storePath), { recursive: true });
    return allocation;
  }

  /**
   * Resolves the SQLite location for an existing document id.
   *
   * @param documentId - utility-minted document identity.
   * @returns the allocation path; the directory is not created.
   */
  document(documentId: string): DocumentAllocation {
    assertSafeSegment("document id", documentId);
    return {
      documentId,
      storePath: path.join(this.#rootPath, "documents", documentId, "document.sqlite"),
    };
  }

  /**
   * Reads the package binding for an exact package address.
   *
   * @param address - package id plus canonical source path.
   * @returns the binding, or null when the package instance has no document.
   */
  packageBinding(address: PackageAddress): PackageBinding | null {
    const bindingPath = this.#bindingPath(address);
    if (!fs.existsSync(bindingPath)) return null;

    return readPackageBinding(bindingPath);
  }

  /**
   * Lists bindings for all known paths of one package id.
   *
   * @param packageId - stable identity stored in a `.shift` manifest.
   * @returns bindings sorted by canonical path for deterministic callers.
   */
  listPackageBindings(packageId: string): PackageBinding[] {
    assertSafeSegment("package id", packageId);
    const directoryPath = path.join(this.#rootPath, "packages", packageId);
    if (!fs.existsSync(directoryPath)) return [];

    const bindings: PackageBinding[] = [];
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

      bindings.push(readPackageBinding(path.join(directoryPath, entry.name)));
    }

    return bindings.sort((left, right) => left.canonicalPath.localeCompare(right.canonicalPath));
  }

  /**
   * Atomically binds a package address to a document id.
   *
   * @param address - package instance being opened.
   * @param documentId - existing utility-owned document allocation.
   * @returns the durable binding that now owns the package address.
   */
  writePackageBinding(address: PackageAddress, documentId: string): PackageBinding {
    const binding: PackageBinding = {
      ...address,
      documentId,
      storePath: this.document(documentId).storePath,
      updatedAt: new Date().toISOString(),
    };

    writeJsonAtomic(this.#bindingPath(address), binding);
    return binding;
  }

  /**
   * Removes the binding for an exact package address.
   *
   * @param address - package instance whose binding should be removed.
   */
  removePackageBinding(address: PackageAddress): void {
    fs.rmSync(this.#bindingPath(address), { force: true });
  }

  /**
   * Records a detached dirty document for future explicit recovery UI.
   *
   * @param binding - package binding that used to own the document.
   * @param reason - stable reason string for diagnostics.
   * @returns the orphan record written to disk.
   */
  orphanDocument(binding: PackageBinding, reason: string): OrphanedDocument {
    const orphan: OrphanedDocument = {
      documentId: binding.documentId,
      storePath: binding.storePath,
      packageId: binding.packageId,
      canonicalPath: binding.canonicalPath,
      reason,
      orphanedAt: new Date().toISOString(),
    };

    writeJsonAtomic(path.join(this.#rootPath, "orphaned", `${binding.documentId}.json`), orphan);
    return orphan;
  }

  /**
   * Deletes a document allocation and its SQLite database.
   *
   * @param documentId - utility-owned document id to remove.
   */
  deleteDocument(documentId: string): void {
    const allocation = this.document(documentId);
    fs.rmSync(path.dirname(allocation.storePath), { recursive: true, force: true });
  }

  #bindingPath(address: PackageAddress): string {
    assertSafeSegment("package id", address.packageId);
    const hash = crypto.createHash("sha256").update(address.canonicalPath).digest("hex");
    return path.join(this.#rootPath, "packages", address.packageId, `${hash}.json`);
  }
}

function readPackageBinding(bindingPath: string): PackageBinding {
  return parsePackageBinding(JSON.parse(fs.readFileSync(bindingPath, "utf8")), bindingPath);
}

function parsePackageBinding(value: unknown, bindingPath: string): PackageBinding {
  const result = packageBindingSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");

    throw new Error(`invalid package binding: ${bindingPath}: ${details}`);
  }

  return result.data;
}

function writeJsonAtomic(targetPath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.tmp`);

  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function assertSafeSegment(label: string, value: string): void {
  if (/^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== "..") return;

  throw new Error(`invalid ${label}: ${value}`);
}
