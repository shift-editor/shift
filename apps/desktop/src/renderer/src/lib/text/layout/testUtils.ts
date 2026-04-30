/**
 * Shared test fixtures for the layout module.
 *
 * Loads a real Font (MutatorSans) via the real Rust bridge — same pattern
 * as `GlyphView.test.ts`. No fakes; tests assert against derived values
 * read from the loaded font, so `expect(... .advance).toBe(font.glyph("A")?.advance)`
 * not a hardcoded 600.
 */
import { Font } from "@/lib/model/Font";
import { createBridge } from "@/testing/engine";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import { TextLayout } from "./TextLayout";
import { Positioner } from "./Positioner";
import type { Cell, GlyphCell, SegmentedRun } from "./types";

export function loadTestFont(): Font {
  const font = new Font(createBridge());
  font.load(MUTATORSANS_DESIGNSPACE);
  return font;
}

export function ltrRun(glyphs: readonly GlyphCell[], clusterStart = 0): SegmentedRun {
  return { glyphs, direction: "ltr", clusterStart };
}

export function makeLayout(cells: readonly Cell[], font: Font): TextLayout {
  return new TextLayout({
    cells,
    origin: { x: 0, y: 0 },
    font,
    positioner: new Positioner(),
  });
}
