/**
 * Branded ID types for type-safe identification of font entities.
 *
 * These types ensure compile-time safety when working with IDs across the
 * TS/Rust boundary. Ids are prefixed strings (`point_<uuid>`). The renderer
 * MINTS ids for entities it creates (client-minted ids: verbs return
 * identity synchronously; Rust validates and honors them); all other ids
 * come from Rust.
 */

// Branded type symbols (never exported, just for type branding)
declare const PointIdBrand: unique symbol;
declare const ContourIdBrand: unique symbol;
declare const AnchorIdBrand: unique symbol;
declare const ComponentIdBrand: unique symbol;
declare const GuidelineIdBrand: unique symbol;
declare const GlyphIdBrand: unique symbol;
declare const LayerIdBrand: unique symbol;
declare const SourceIdBrand: unique symbol;

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
 * A component identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
export type ComponentId = string & { readonly [ComponentIdBrand]: typeof ComponentIdBrand };

/**
 * A guideline identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
export type GuidelineId = string & { readonly [GuidelineIdBrand]: typeof GuidelineIdBrand };

/**
 * A glyph identifier from Rust.
 * Branded string type - can't be confused with names or other IDs.
 */
export type GlyphId = string & { readonly [GlyphIdBrand]: typeof GlyphIdBrand };

/**
 * A layer identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
export type LayerId = string & { readonly [LayerIdBrand]: typeof LayerIdBrand };

/**
 * A source identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
export type SourceId = string & { readonly [SourceIdBrand]: typeof SourceIdBrand };

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
 * Convert a string ID from Rust to a typed ComponentId.
 * Use this when receiving IDs from Rust snapshots.
 */
export function asComponentId(id: string): ComponentId {
  return id as ComponentId;
}

/**
 * Convert a string ID from Rust to a typed GuidelineId.
 * Use this when receiving IDs from Rust snapshots.
 */
export function asGuidelineId(id: string): GuidelineId {
  return id as GuidelineId;
}

/**
 * Convert a string ID from Rust to a typed GlyphId.
 * Use this when receiving IDs from Rust snapshots.
 */
export function asGlyphId(id: string): GlyphId {
  return id as GlyphId;
}

/**
 * Convert a string ID from Rust to a typed LayerId.
 * Use this when receiving IDs from Rust snapshots.
 */
export function asLayerId(id: string): LayerId {
  return id as LayerId;
}

/**
 * Convert a string ID from Rust to a typed SourceId.
 * Use this when receiving IDs from Rust snapshots.
 */
export function asSourceId(id: string): SourceId {
  return id as SourceId;
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

/**
 * Type guard to check if a value is a valid ComponentId.
 * Useful for runtime validation in debug builds.
 */
export function isValidComponentId(id: unknown): id is ComponentId {
  return typeof id === "string" && id.length > 0;
}

/**
 * Type guard to check if a value is a valid GuidelineId.
 * Useful for runtime validation in debug builds.
 */
export function isValidGuidelineId(id: unknown): id is GuidelineId {
  return typeof id === "string" && id.length > 0;
}

/**
 * Type guard to check if a value is a valid GlyphId.
 * Useful for runtime validation in debug builds.
 */
export function isValidGlyphId(id: unknown): id is GlyphId {
  return typeof id === "string" && id.length > 0;
}

/**
 * Type guard to check if a value is a valid LayerId.
 * Useful for runtime validation in debug builds.
 */
export function isValidLayerId(id: unknown): id is LayerId {
  return typeof id === "string" && id.length > 0;
}

/**
 * Type guard to check if a value is a valid SourceId.
 * Useful for runtime validation in debug builds.
 */
export function isValidSourceId(id: unknown): id is SourceId {
  return typeof id === "string" && id.length > 0;
}

// Web Crypto's global, present in both the renderer and node >= 19. The
// shared lib config deliberately includes neither DOM nor node types.
declare const crypto: { randomUUID(): string };

/**
 * Mints a new point id. Client-minted ids let editing verbs return identity
 * synchronously; Rust honors them and rejects duplicates.
 */
export function mintPointId(): PointId {
  return `point_${crypto.randomUUID()}` as PointId;
}

/** Mints a new contour id. See {@link mintPointId}. */
export function mintContourId(): ContourId {
  return `contour_${crypto.randomUUID()}` as ContourId;
}

/** Mints a new anchor id. See {@link mintPointId}. */
export function mintAnchorId(): AnchorId {
  return `anchor_${crypto.randomUUID()}` as AnchorId;
}

/** Mints a new glyph id. See {@link mintPointId}. */
export function mintGlyphId(): GlyphId {
  return `glyph_${crypto.randomUUID()}` as GlyphId;
}
