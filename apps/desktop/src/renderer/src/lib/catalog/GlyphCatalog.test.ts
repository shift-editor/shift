import { afterEach, describe, expect, it } from "vitest";
import { effect } from "@shift/editor/signals";
import type { EditorTestSurface } from "@/testing/surface";
import { authoredGlyphAtlas, startTestEditor } from "@/testing/TestEditor";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { GlyphCatalog } from "./GlyphCatalog";

const WEIGHT = { tag: "wght", name: "Weight", minimum: 100, default: 400, maximum: 900 };

describe("GlyphCatalog", () => {
  let editor: EditorTestSurface;

  afterEach(() => editor.close());

  it("keeps its metrics readable when the active source is deleted", async () => {
    editor = await startTestEditor();
    await editor.addAxis(WEIGHT);
    await editor.addSource("Bold", { wght: 900 });
    const bold = editor.source({ name: "Bold" });
    if (!bold) throw new Error("Expected the Bold source");
    editor.setLocation({ wght: 900 });
    expect(editor.source("active")).toMatchObject({ id: bold.id });

    const catalog = new GlyphCatalog(editor.asEditor(), getGlyphInfo(), authoredGlyphAtlas(editor));
    const reader = effect(() => {
      catalog.metricsCell.value;
    });

    await editor.deleteSource("Bold");
    reader.dispose();

    // A delete the workspace rejects is rolled back once the edits settle, bringing Bold back.
    expect(editor.source({ name: "Bold" })).toBeNull();
    expect(editor.fontOverview().sources).not.toContainEqual(
      expect.objectContaining({ id: bold.id }),
    );
    expect(catalog.metricsCell.peek().unitsPerEm).toBe(editor.metrics().unitsPerEm);
  });

  it("follows a master's metric edit between the masters", async () => {
    editor = await startTestEditor();
    await editor.addAxis(WEIGHT);
    await editor.addSource("Bold", { wght: 900 });
    editor.setLocation({ wght: 650 });
    const catalog = new GlyphCatalog(editor.asEditor(), getGlyphInfo(), authoredGlyphAtlas(editor));
    const ascenders: number[] = [];
    const reader = effect(() => {
      ascenders.push(catalog.metricsCell.value.ascender);
    });
    const before = catalog.metricsCell.peek().ascender;

    const ascender = editor
      .fontOverview()
      .metricDefinitions.find((definition) => definition.kind === "ascender");
    const boldAscender = ascender && editor.source({ name: "Bold" })?.metricValues[ascender.id];
    if (!ascender || !boldAscender) throw new Error("Expected Bold's ascender");
    const edited = editor.setSourceMetric("Bold", ascender.name, boldAscender.position + 200);
    expect(catalog.metricsCell.peek().ascender).toBeCloseTo(before + 100);
    await edited;
    reader.dispose();

    expect(ascenders.at(-1)).toBeCloseTo(before + 100);
  });
});
