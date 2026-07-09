import type { WorkspacePackageIdentity } from "../../shared/workspace/protocol";

/** Identifies one utility-owned SQLite document allocation. */
export type DocumentAllocation = {
  documentId: string;
  storePath: string;
};

/** Identifies one package instance by package id and canonical source path. */
export type PackageAddress = {
  packageId: string;
  canonicalPath: string;
};

/** Binds one package instance to its current working document. */
export type PackageBinding = PackageAddress &
  DocumentAllocation & {
    updatedAt: string;
  };

/** Records a dirty working document detached from its package binding. */
export type OrphanedDocument = DocumentAllocation & {
  packageId: string;
  canonicalPath: string;
  reason: string;
  orphanedAt: string;
};

/** Describes the package-open transition chosen before mutating bindings. */
export type PackageOpenTransition =
  | { kind: "hydrateFresh"; identity: WorkspacePackageIdentity }
  | { kind: "resumeExact"; identity: WorkspacePackageIdentity; binding: PackageBinding }
  | { kind: "replaceClean"; identity: WorkspacePackageIdentity; binding: PackageBinding }
  | { kind: "orphanDiverged"; identity: WorkspacePackageIdentity; binding: PackageBinding }
  | { kind: "resumeMoved"; identity: WorkspacePackageIdentity; binding: PackageBinding };
