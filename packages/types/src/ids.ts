/**
 * Branded ID types for type-safe identification of Rust entities.
 *
 * These types ensure compile-time safety when working with IDs from Rust.
 * TypeScript never generates IDs - they always come from Rust.
 */

// Branded type symbols (never exported, just for type branding)
declare const PointIdBrand: unique symbol;
declare const ContourIdBrand: unique symbol;
declare const AnchorIdBrand: unique symbol;

/**
 * A point identifier from Rust.
 * Branded string type - can't be confused with ContourId or plain strings.
 */
export type PointId = string & { readonly [PointIdBrand]: typeof PointIdBrand };

/**
 * A contour identifier from Rust.
 * Branded string type - can't be confused with PointId or plain strings.
 */
export type ContourId = string & {
  readonly [ContourIdBrand]: typeof ContourIdBrand;
};

/**
 * An anchor identifier from Rust.
 * Branded string type - can't be confused with PointId/ContourId or plain strings.
 */
export type AnchorId = string & { readonly [AnchorIdBrand]: typeof AnchorIdBrand };

/**
 * Convert a string ID from Rust to a typed PointId.
 * Use this when receiving IDs from Rust snapshots.
 */
export function asPointId(id: string): PointId {
  return id as PointId;
}

/**
 * Convert a string ID from Rust to a typed ContourId.
 * Use this when receiving IDs from Rust snapshots.
 */
export function asContourId(id: string): ContourId {
  return id as ContourId;
}

/**
 * Convert a string ID from Rust to a typed AnchorId.
 * Use this when receiving IDs from Rust snapshots.
 */
export function asAnchorId(id: string): AnchorId {
  return id as AnchorId;
}

/**
 * Type guard to check if a value is a valid PointId.
 * Useful for runtime validation in debug builds.
 */
export function isValidPointId(id: unknown): id is PointId {
  return typeof id === "string" && id.length > 0;
}

/**
 * Type guard to check if a value is a valid ContourId.
 * Useful for runtime validation in debug builds.
 */
export function isValidContourId(id: unknown): id is ContourId {
  return typeof id === "string" && id.length > 0;
}

/**
 * Type guard to check if a value is a valid AnchorId.
 * Useful for runtime validation in debug builds.
 */
export function isValidAnchorId(id: unknown): id is AnchorId {
  return typeof id === "string" && id.length > 0;
}
