/**
 * Shared test fixtures for the layout module.
 *
 * Loads a real Font (MutatorSans) via the real Rust bridge — same pattern
 * as the model tests. No fakes; tests assert against derived values read from
 * the loaded font, not hardcoded advances.
 */
import { Font } from "@/lib/model/Font";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import { TextLayout } from "./TextLayout";
import { Positioner } from "./Positioner";
import type { Cell, GlyphCell, SegmentedRun } from "./types";
import { signal } from "@/lib/signals/signal";
import { createBridge } from "@shift/bridge";

export function loadTestFont(): Font {
  const bridge = createBridge();
  const font = new Font(bridge);

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
    designLocation: signal(font.defaultLocation()),
  });
}
