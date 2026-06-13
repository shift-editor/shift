/**
 * Shared test fixtures for the layout module.
 *
 * Builds a real Font through the workspace stack (real NAPI, real SQLite):
 * glyphs A/B/C with distinct advances, and real triangle geometry on A so
 * outline bounds flow through positioning. No fakes; tests assert against
 * values read back from the workspace, not hardcoded advances.
 */
import { mintGlyphId, type GlyphName, type Unicode } from "@shift/types";
import { signal } from "@/lib/signals/signal";
import type { Font } from "@/lib/model/Font";
import { createWorkspaceStack } from "@/testing/workspaceStack";
import { TextLayout } from "./TextLayout";
import { Positioner } from "./Positioner";
import type { TextItem, GlyphTextItem, SegmentedRun } from "./types";

const GLYPHS: ReadonlyArray<readonly [string, number, number]> = [
  ["A", 65, 500],
  ["B", 66, 600],
  ["C", 67, 700],
];

export async function layoutTestFont(): Promise<Font> {
  const stack = createWorkspaceStack();
  await stack.client.create();

  for (const [name, unicode, advance] of GLYPHS) {
    const applied = await stack.client.apply([
      {
        kind: "createGlyph",
        createGlyph: { glyphId: mintGlyphId(), name: name as GlyphName, unicodes: [unicode] },
      },
    ]);
    const layerId = applied.layers[0]?.layerId;
    const record = applied.glyphs?.find((glyph) => glyph.name === name);
    if (!layerId || !record) throw new Error(`createGlyph did not echo ${name}`);

    await stack.client.apply([{ kind: "setXAdvance", setXAdvance: { layerId, width: advance } }]);
    await stack.font.openGlyph(record.id, stack.font.defaultSource);
  }

  const handle = stack.font.glyphHandleForUnicode(65 as Unicode);
  const a = stack.font.glyphSource(handle, stack.font.defaultSource);
  if (!a) throw new Error("Expected editable glyph source for A");

  const contourId = a.addContour();
  a.addOnCurvePoint(contourId, { x: 0, y: 0 });
  a.addOnCurvePoint(contourId, { x: 100, y: 0 });
  a.addOnCurvePoint(contourId, { x: 50, y: 100 });
  a.closeContour(contourId);
  await stack.writer.settled();

  return stack.font;
}

export function ltrRun(glyphs: readonly GlyphTextItem[], clusterStart = 0): SegmentedRun {
  return { glyphs, direction: "ltr", clusterStart };
}

export function makeLayout(items: readonly TextItem[], font: Font): TextLayout {
  return new TextLayout({
    items,
    origin: { x: 0, y: 0 },
    font,
    positioner: new Positioner(),
    designLocation: signal(font.defaultLocation()),
  });
}
