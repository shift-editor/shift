import { describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { glyphTextItem } from "@shift/editor/text";
import {
  defaultExternalAxisLocation,
  externalAxisLocationFromRecord,
  withExternalAxisValue,
} from "@shift/editor/variation";

describe("placed text layout follows font location", () => {
  it("interpolates a run's advance between authored masters", async () => {
    const editor = new TestEditor();
    await editor.startSession();
    const glyph = editor.glyphForId(editor.glyphRecord!.id)!;
    editor.requireGlyphLayer().setXAdvance(300);
    await editor.settle();

    const axisId = editor.font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await editor.settle();
    const sourceId = editor.createSource("Bold", externalAxisLocationFromRecord({ [axisId]: 700 }));
    await editor.settle();
    glyph.layerForSource(sourceId)!.setXAdvance(500);
    await editor.settle();
    editor.setSourceToDefault();

    const run = editor.text.createRun([
      glyphTextItem(glyph.handle.name, glyph.handle.unicode ?? null),
    ]);
    expect(editor.text.layoutCell(run.id).peek()?.totalAdvance).toBeCloseTo(300);

    const midpoint = withExternalAxisValue(
      defaultExternalAxisLocation(editor.font.getAxes()),
      editor.font.getAxes()[0]!,
      550,
    );
    editor.setExternalLocation(midpoint);
    expect(editor.text.layoutCell(run.id).peek()?.totalAdvance).toBeCloseTo(400);
  });
});
