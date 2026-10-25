/**
 * Shared test fixtures for the layout module.
 *
 * Builds a real Editor through the workspace stack (real NAPI, real SQLite):
 * glyphs A/B/C with distinct advances, and real triangle geometry on A so
 * outline bounds flow through positioning. No fakes; tests assert against
 * values read back from the workspace, not hardcoded advances.
 *
 * The session is a preview, whose text is never shaped, so every layout
 * places each paragraph literally, without anchor attachment.
 */
import { TestEditor } from "@/testing/TestEditor";
import type { TextItem } from "@shift/editor/text";

const GLYPHS: ReadonlyArray<readonly [string, number, number]> = [
  ["A", 65, 500],
  ["B", 66, 600],
  ["C", 67, 700],
];

export async function layoutTestEditor(): Promise<TestEditor> {
  const editor = new TestEditor("preview");
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

/** Creates a text run of `items` and returns the layout the editor gives it. */
export function makeLayout(items: readonly TextItem[], editor: TestEditor) {
  const run = editor.text.createRun(items);
  const layout = editor.text.layoutCell(run.id).peek();
  if (!layout) throw new Error("Expected a layout for the new text run");
  return layout;
}
