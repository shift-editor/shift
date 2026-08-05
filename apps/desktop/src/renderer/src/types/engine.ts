import type { GlyphId, GlyphSnapshot } from "@shift/types";

/** Acquires complete root and component projections from the session boundary. */
export interface GlyphReader {
  read(glyphIds: readonly GlyphId[]): Promise<readonly GlyphSnapshot[]>;
}
