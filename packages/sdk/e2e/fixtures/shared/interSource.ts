import type { FontSnapshot, GlyphRecord, GlyphSnapshot, MemoryFontSource } from "@shift-editor/sdk";
import fixture from "./inter-a.json";

interface InterFixture {
  readonly font: FontSnapshot;
  readonly glyphs: readonly GlyphSnapshot[];
  readonly records: readonly GlyphRecord[];
}

/** Restores the `{ $float64: [...] }` encoding written by `generate-inter-a-fixture.mjs`. */
function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value === null || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const float64 = record.$float64;
  if (Array.isArray(float64) && Object.keys(record).length === 1) {
    return new Float64Array(float64 as number[]);
  }

  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, revive(entry)]));
}

/** Inter's lowercase `a` with every master, served from memory. */
export function interASource(): MemoryFontSource {
  const { font, glyphs, records } = revive(fixture) as InterFixture;

  return {
    font,
    records,
    read: (glyphIds) => Promise.resolve(glyphs.filter((glyph) => glyphIds.includes(glyph.glyphId))),
    glyphPreviews: () => Promise.resolve([]),
  };
}
