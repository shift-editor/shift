import type { WorkspacePackageIdentity } from "../../shared/workspace/protocol";

/** Identifies one utility-owned SQLite document allocation. */
export type DocumentAllocation = {
  documentId: string;
  storePath: string;
};

/**
 * Identifies one package instance by package id and canonical source path.
 *
 * @remarks
 * Package addresses intentionally ignore source fingerprints. They identify the
 * durable binding slot; fingerprint comparisons belong to package open actions.
 */
export class PackageAddress {
  readonly packageId: string;
  readonly canonicalPath: string;

  /**
   * Creates a package address from durable package identity fields.
   *
   * @param packageId - stable id stored in the `.shift` manifest.
   * @param canonicalPath - canonical source path for this package instance.
   */
  constructor(packageId: string, canonicalPath: string) {
    this.packageId = packageId;
    this.canonicalPath = canonicalPath;
  }

  /**
   * Builds a package address from an inspected package identity.
   *
   * @param identity - package identity returned by Rust for the current source path.
   * @returns package id and canonical path; the source fingerprint is excluded.
   */
  static fromIdentity(identity: WorkspacePackageIdentity): PackageAddress {
    return new PackageAddress(identity.packageId, identity.canonicalPath);
  }

  /**
   * Compares package addresses by durable package id and canonical source path.
   *
   * @param left - first package address.
   * @param right - second package address.
   * @returns true when both addresses identify the same package path.
   */
  static equals(left: PackageAddress, right: PackageAddress): boolean {
    return left.packageId === right.packageId && left.canonicalPath === right.canonicalPath;
  }
}

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

/** Describes the package-open action chosen before mutating bindings. */
export type PackageOpenAction =
  | { kind: "hydrate" }
  | { kind: "resume"; binding: PackageBinding }
  | { kind: "replace"; binding: PackageBinding }
  | { kind: "orphan"; binding: PackageBinding }
  | { kind: "move"; binding: PackageBinding };

/** Document and package address settled by a package open. */
export type PackageOpenResult = {
  document: DocumentAllocation;
  address: PackageAddress;
};
