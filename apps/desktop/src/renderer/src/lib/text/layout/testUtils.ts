/**
 * Shared test fixtures for the layout module.
 *
 * Builds a real Editor through the workspace stack (real NAPI, real SQLite):
 * glyphs A/B/C with distinct advances, and real triangle geometry on A so
 * outline bounds flow through positioning. No fakes; tests assert against
 * values read back from the workspace, not hardcoded advances.
 */
import { signal } from "@/lib/signals/signal";
import { TestEditor } from "@/testing/TestEditor";
import { TextLayout } from "./TextLayout";
import { Positioner } from "./Positioner";
import type { TextItem, GlyphTextItem, SegmentedRun } from "./types";

const GLYPHS: ReadonlyArray<readonly [string, number, number]> = [
  ["A", 65, 500],
  ["B", 66, 600],
  ["C", 67, 700],
];

export async function layoutTestEditor(): Promise<TestEditor> {
  const editor = new TestEditor();
  await editor.startSession();

  for (const [name, unicode, advance] of GLYPHS) {
    if (name !== "A") await editor.addGlyph(name, unicode);

    const record = editor.font.recordForName(name);
    if (!record) throw new Error(`Expected Glyph record for ${name}`);
    const glyph = editor.glyphForId(record.id);
    if (!glyph) throw new Error(`Expected acquired Glyph for ${name}`);
    const layer = glyph.layerForSource(editor.font.defaultSource.id);
    if (!layer) throw new Error(`Expected authored Glyph layer for ${name}`);

    layer.setXAdvance(advance);
  }

  const layer = editor.requireGlyphLayer();
  const contourId = layer.addContour();
  layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
  layer.addOnCurvePoint(contourId, { x: 100, y: 0 });
  layer.addOnCurvePoint(contourId, { x: 50, y: 100 });
  layer.closeContour(contourId);
  await editor.settle();

  return editor;
}

export function ltrRun(glyphs: readonly GlyphTextItem[], clusterStart = 0): SegmentedRun {
  return { glyphs, direction: "ltr", clusterStart };
}

export function makeLayout(items: readonly TextItem[], editor: TestEditor): TextLayout {
  return new TextLayout({
    items,
    origin: { x: 0, y: 0 },
    editor,
    positioner: new Positioner(),
    externalLocation: signal(editor.font.defaultLocation()),
  });
}
