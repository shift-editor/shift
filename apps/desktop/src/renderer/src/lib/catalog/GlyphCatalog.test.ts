import { afterEach, describe, expect, it } from "vitest";
import { effect } from "@shift/editor/signals";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import { AuthoredGlyphAtlasSource } from "@/lib/graphics/backends/AuthoredGlyphAtlasSource";
import { TestEditor } from "@/testing/TestEditor";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { GlyphCatalog } from "./GlyphCatalog";

describe("GlyphCatalog", () => {
  let editor: TestEditor;

  afterEach(() => editor.destroy());

  it("keeps its metrics readable when the active source is deleted", async () => {
    editor = await new TestEditor().startSession();
    const font = editor.font;
    const axisId = font.createAxis({
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
    const boldId = font.createSource("Bold", externalAxisLocationFromRecord({ [axisId]: 900 }));
    await editor.settle();
    editor.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 900 }));
    expect(editor.activeSourceIdCell.peek()).toBe(boldId);

    const catalog = new GlyphCatalog(
      editor,
      getGlyphInfo(),
      new AuthoredGlyphAtlasSource(
        editor.workspaceEditCoordinator,
        () => font.getAxes(),
        () => font.getAxisMappingBases(),
      ),
    );
    const reader = effect(() => {
      catalog.metricsCell.value;
    });
    const outcomes: string[] = [];
    const stopListening = font.editCoordinator.onEdit((event) => outcomes.push(event.kind));

    font.deleteSource(boldId);
    await editor.settle();
    stopListening();
    reader.dispose();

    expect(outcomes).toEqual(["accepted", "committed"]);
    expect(font.sources.map(({ id }) => id)).not.toContain(boldId);
    expect(catalog.metricsCell.peek().unitsPerEm).toBe(font.metrics.unitsPerEm);
  });
});
