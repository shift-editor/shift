import type { GlyphId, GlyphName } from "@shift/types";

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
