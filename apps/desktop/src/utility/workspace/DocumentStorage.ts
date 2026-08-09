import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DocumentAddress, type DocumentBinding, type WorkspaceAllocation } from "./types";

const SQLITE_SIDECAR_SUFFIXES = ["", "-wal", "-shm", "-journal"] as const;

const documentBindingSchema = z
  .object({
    documentId: z.string(),
    canonicalPath: z.string(),
    workspaceId: z.string(),
    storePath: z.string(),
    recoveryPath: z.string(),
    updatedAt: z.string(),
  })
  .strict();

/** Owns app-local workspace allocations and canonical-document recovery bindings. */
export class DocumentStorage {
  readonly #rootPath: string;
  readonly #createId: () => string;

  constructor(rootPath: string, createId = () => crypto.randomUUID()) {
    this.#rootPath = rootPath;
    this.#createId = createId;
  }

  /** Mints one app-local workspace and creates its private directory. */
  createWorkspace(): WorkspaceAllocation {
    const workspaceId = this.#createId();
    const allocation = this.workspace(workspaceId);

    fs.mkdirSync(path.dirname(allocation.storePath), { recursive: true });
    return allocation;
  }

  /** Resolves app-local persistence paths without creating them. */
  workspace(workspaceId: string): WorkspaceAllocation {
    assertSafeSegment("workspace id", workspaceId);
    const workspacePath = path.join(this.#rootPath, "workspaces", workspaceId);
    return {
      workspaceId,
      storePath: path.join(workspacePath, "document.sqlite"),
      recoveryPath: path.join(workspacePath, "recovery.sqlite"),
    };
  }

  /** Allocates a fresh recovery filename inside an existing workspace. */
  createRecoveryPath(workspaceId: string): string {
    const workspace = this.workspace(workspaceId);
    fs.mkdirSync(path.dirname(workspace.recoveryPath), { recursive: true });
    return path.join(path.dirname(workspace.recoveryPath), `recovery-${this.#createId()}.sqlite`);
  }

  /** Removes a complete working store after native Save As adopts its snapshot. */
  deleteWorkingStore(workspaceId: string): void {
    const { storePath } = this.workspace(workspaceId);
    for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
      fs.rmSync(`${storePath}${suffix}`, { force: true });
    }
  }

  /** Removes an obsolete recovery file and its SQLite sidecars. */
  deleteRecovery(recoveryPath: string): void {
    for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
      fs.rmSync(`${recoveryPath}${suffix}`, { force: true });
    }
  }

  /** Reads the recovery binding for one exact document identity and path. */
  documentBinding(address: DocumentAddress): DocumentBinding | null {
    const bindingPath = this.#bindingPath(address);
    if (!fs.existsSync(bindingPath)) return null;

    const binding = readDocumentBinding(bindingPath);
    this.#validateBinding(address, binding, bindingPath);
    return binding;
  }

  /** Lists every path binding for one canonical document identity. */
  listDocumentBindings(documentId: string): DocumentBinding[] {
    assertSafeSegment("document id", documentId);
    const directoryPath = path.join(this.#rootPath, "bindings", documentId);
    if (!fs.existsSync(directoryPath)) return [];

    const bindings: DocumentBinding[] = [];
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

      const bindingPath = path.join(directoryPath, entry.name);
      const binding = readDocumentBinding(bindingPath);
      const address = new DocumentAddress(documentId, binding.canonicalPath);
      this.#validateBinding(address, binding, bindingPath);
      bindings.push(binding);
    }

    return bindings.sort((left, right) => left.canonicalPath.localeCompare(right.canonicalPath));
  }

  /** Atomically binds one canonical document address to an app-local workspace. */
  writeDocumentBinding(address: DocumentAddress, workspace: WorkspaceAllocation): DocumentBinding {
    const binding: DocumentBinding = {
      documentId: address.documentId,
      canonicalPath: address.canonicalPath,
      workspaceId: workspace.workspaceId,
      storePath: workspace.storePath,
      recoveryPath: workspace.recoveryPath,
      updatedAt: new Date().toISOString(),
    };

    writeJsonAtomic(this.#bindingPath(address), binding);
    return binding;
  }

  /** Removes one exact canonical-document recovery binding. */
  removeDocumentBinding(address: DocumentAddress): void {
    fs.rmSync(this.#bindingPath(address), { force: true });
  }

  /** Deletes one app-local workspace and all of its SQLite sidecars. */
  deleteWorkspace(workspaceId: string): void {
    const allocation = this.workspace(workspaceId);
    fs.rmSync(path.dirname(allocation.storePath), { recursive: true, force: true });
  }

  #bindingPath(address: DocumentAddress): string {
    assertSafeSegment("document id", address.documentId);
    const hash = crypto.createHash("sha256").update(address.canonicalPath).digest("hex");
    return path.join(this.#rootPath, "bindings", address.documentId, `${hash}.json`);
  }

  #validateBinding(address: DocumentAddress, binding: DocumentBinding, bindingPath: string): void {
    const expectedBindingPath = path.resolve(this.#bindingPath(address));
    if (
      !DocumentAddress.equals(address, binding) ||
      path.resolve(bindingPath) !== expectedBindingPath
    ) {
      throw new Error(`invalid document binding: ${bindingPath}: document address mismatch`);
    }

    const expected = this.workspace(binding.workspaceId);
    const expectedDirectory = path.resolve(path.dirname(expected.recoveryPath));
    const recoveryDirectory = path.resolve(path.dirname(binding.recoveryPath));
    const recoveryFileName = path.basename(binding.recoveryPath);
    if (
      path.resolve(binding.storePath) !== path.resolve(expected.storePath) ||
      recoveryDirectory !== expectedDirectory ||
      !/^recovery(?:-[A-Za-z0-9._-]+)?\.sqlite$/.test(recoveryFileName)
    ) {
      throw new Error(`invalid document binding: ${bindingPath}: workspace path mismatch`);
    }
  }
}

function readDocumentBinding(bindingPath: string): DocumentBinding {
  const result = documentBindingSchema.safeParse(JSON.parse(fs.readFileSync(bindingPath, "utf8")));
  if (result.success) return result.data;

  const details = result.error.issues
    .map((issue) => {
      const issuePath = issue.path.join(".");
      return issuePath ? `${issuePath}: ${issue.message}` : issue.message;
    })
    .join("; ");
  throw new Error(`invalid document binding: ${bindingPath}: ${details}`);
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
