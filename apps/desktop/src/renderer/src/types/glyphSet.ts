import type { GlyphName } from "@shift/types";

export interface GlyphSet {
  readonly id: string;
  readonly name: string;
  readonly scope: "builtIn" | "user" | "font";
  readonly glyphNames: readonly GlyphName[];
}

export type AddGlyphsTab = "glyphs" | "sets" | "builder";

export interface GlyphListResult {
  readonly glyphNames: readonly GlyphName[];
  readonly errors: readonly string[];
}
