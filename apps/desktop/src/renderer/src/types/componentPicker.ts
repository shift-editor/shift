import type { GlyphId, GlyphName, GlyphRecord } from "@shift/types";
import type { GlyphCatalogItem } from "./glyphCatalog";

export type ComponentCandidate =
  | {
      readonly availability: "existing";
      readonly glyphId: GlyphId;
      readonly name: GlyphName;
      readonly displayName: string;
      readonly unicode: number | null;
    }
  | {
      readonly availability: "missing";
      readonly glyphId: null;
      readonly name: GlyphName;
      readonly displayName: string;
      readonly unicode: number;
    };

/** The glyph a new component goes into, looked up once for the whole picker query. */
export interface ComponentOwner {
  readonly id: GlyphId;
  /** Its catalog entry, or null when the catalog does not list it. */
  readonly glyph: GlyphCatalogItem | null;
  /** Its committed record, or null before it has one. */
  readonly record: GlyphRecord | null;
}
