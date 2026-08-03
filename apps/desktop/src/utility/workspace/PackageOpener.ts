import type { ShiftBridge } from "@shift/bridge";
import fs from "node:fs";
import type { WorkspacePackageIdentity } from "../../shared/workspace/protocol";
import type { DocumentStorage } from "./DocumentStorage";
import {
  PackageAddress,
  type DocumentAllocation,
  type PackageBinding,
  type PackageOpenAction,
  type PackageOpenResult,
} from "./types";

/**
 * Opens package-backed workspaces while preserving dirty local documents.
 *
 * @remarks
 * Package opens resolve through a small action machine over the durable binding,
 * the source fingerprint, and the saved draft metadata. Dirty matching drafts
 * resume; clean drafts are replaceable; dirty divergent drafts are orphaned
 * before a fresh hydrate. Moved packages resume only when exactly one missing
 * old path matches the package id and base fingerprint.
 */
export class PackageOpener {
  readonly #bridge: ShiftBridge;
  readonly #documents: DocumentStorage;

  /**
   * Creates a package opener bound to the utility process services.
   *
   * @param bridge - live Rust bridge mutated when workspaces open or resume.
   * @param documents - durable document and package binding storage.
   */
  constructor(bridge: ShiftBridge, documents: DocumentStorage) {
    this.#bridge = bridge;
    this.#documents = documents;
  }

  /**
   * Opens a package identity and returns the document the host should adopt.
   *
   * @param identity - current package id, canonical source path, and source fingerprint.
   * @returns the document allocation and package address after bindings are settled.
   * @throws {Error} when a stored binding points at a different package id.
   */
  open(identity: WorkspacePackageIdentity): PackageOpenResult {
    const action = this.#actionFor(identity);

    switch (action.kind) {
      case "hydrate":
        return this.#hydrate(identity);
      case "resume":
        return this.#resume(identity, action.binding);
      case "replace":
        return this.#replace(identity, action.binding);
      case "orphan":
        return this.#orphan(identity, action.binding);
      case "move":
        return this.#move(identity, action.binding);
      default:
        assertNever(action);
    }
  }

  #actionFor(identity: WorkspacePackageIdentity): PackageOpenAction {
    const address = PackageAddress.fromIdentity(identity);
    const binding = this.#documents.packageBinding(address);
    if (!binding) {
      const moved = this.#movedBinding(identity);
      return moved ? { kind: "move", binding: moved } : { kind: "hydrate" };
    }

    const draft = this.#bridge.inspectPackageDraft(binding.storePath);
    if (draft.packageId !== identity.packageId) {
      throw new Error(
        `package binding ${binding.documentId} points at ${draft.packageId}, expected ${identity.packageId}`,
      );
    }

    if (!draft.dirty) return { kind: "replace", binding };
    if (draft.baseFingerprint === identity.fingerprint) return { kind: "resume", binding };

    return { kind: "orphan", binding };
  }

  #movedBinding(identity: WorkspacePackageIdentity): PackageBinding | null {
    const candidates: PackageBinding[] = [];

    for (const binding of this.#documents.listPackageBindings(identity.packageId)) {
      if (binding.canonicalPath === identity.canonicalPath) continue;
      if (pathExists(binding.canonicalPath)) continue;

      const draft = this.#inspectDraftOrNull(binding);
      if (!draft?.dirty) continue;
      if (draft.packageId !== identity.packageId) continue;
      if (draft.baseFingerprint !== identity.fingerprint) continue;

      candidates.push(binding);
    }

    return candidates.length === 1 ? candidates[0] : null;
  }

  #inspectDraftOrNull(
    binding: PackageBinding,
  ): ReturnType<ShiftBridge["inspectPackageDraft"]> | null {
    try {
      return this.#bridge.inspectPackageDraft(binding.storePath);
    } catch {
      return null;
    }
  }

  #hydrate(identity: WorkspacePackageIdentity): PackageOpenResult {
    const document = this.#createDocument(identity);
    return { document, address: PackageAddress.fromIdentity(identity) };
  }

  #resume(identity: WorkspacePackageIdentity, binding: PackageBinding): PackageOpenResult {
    this.#bridge.resumeWorkspaceForSource(binding.storePath, identity.canonicalPath);
    this.#bridge.setDocumentId(binding.documentId);
    return { document: binding, address: PackageAddress.fromIdentity(identity) };
  }

  #replace(identity: WorkspacePackageIdentity, binding: PackageBinding): PackageOpenResult {
    const opened = this.#hydrate(identity);
    this.#documents.deleteDocument(binding.documentId);
    return opened;
  }

  #orphan(identity: WorkspacePackageIdentity, binding: PackageBinding): PackageOpenResult {
    const opened = this.#hydrate(identity);
    this.#documents.orphanDocument(binding, "source-diverged");
    return opened;
  }

  #move(identity: WorkspacePackageIdentity, binding: PackageBinding): PackageOpenResult {
    this.#bridge.resumeWorkspaceForSource(binding.storePath, identity.canonicalPath);
    this.#bridge.setDocumentId(binding.documentId);
    this.#documents.writePackageBinding(PackageAddress.fromIdentity(identity), binding.documentId);
    this.#documents.removePackageBinding({
      packageId: binding.packageId,
      canonicalPath: binding.canonicalPath,
    });
    return { document: binding, address: PackageAddress.fromIdentity(identity) };
  }

  #createDocument(identity: WorkspacePackageIdentity): DocumentAllocation {
    const document = this.#documents.createDocument();

    try {
      this.#bridge.openWorkspace(identity.canonicalPath, document.storePath);
      this.#bridge.setDocumentId(document.documentId);
      this.#documents.writePackageBinding(
        PackageAddress.fromIdentity(identity),
        document.documentId,
      );
      return document;
    } catch (error) {
      this.#documents.deleteDocument(document.documentId);
      throw error;
    }
  }
}

function pathExists(sourcePath: string): boolean {
  return fs.existsSync(sourcePath);
}

function assertNever(value: never): never {
  throw new Error(`unknown package open action: ${JSON.stringify(value)}`);
}
