import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { GlyphName, PropagatedAnchor, SourceId } from "@shift/types";
import { effect, signal } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";

const FIXTURE = resolve(process.cwd(), "../../fixtures/fonts/AnchorPropagation.glyphs");

function sorted(anchors: readonly PropagatedAnchor[]): PropagatedAnchor[] {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return anchors
    .map(({ name, x, y }) => ({ name, x: round(x), y: round(y) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe("anchors with components match what export compiles", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await new TestEditor().openSession(FIXTURE, "a");
    for (const record of editor.font.glyphRecords()) await editor.font.loadGlyph(record.id);
  });

  /** The editor's anchors for a glyph at one source. */
  function editorAnchors(glyphName: string, sourceId: SourceId): PropagatedAnchor[] {
    const record = editor.font.recordForName(glyphName as GlyphName)!;
    const location = editor.font.externalLocationForSource(sourceId)!;
    const model = editor.glyphForId(record.id)!.renderModelAt(signal(location), signal(sourceId));
    return sorted(model.anchorsWithComponents);
  }

  /** Compares every glyph at every source it has a layer for; returns how many were compared. */
  async function compareAll(): Promise<number> {
    let compared = 0;
    for (const glyph of await editor.propagatedAnchors()) {
      for (const source of glyph.sources) {
        expect
          .soft(editorAnchors(glyph.glyphName, source.sourceId), glyph.glyphName)
          .toEqual(sorted(source.anchors));
        compared++;
      }
    }
    return compared;
  }

  it("for every glyph at every master", async () => {
    expect(await compareAll()).toBeGreaterThan(40);
  });

  it("follows a moved base anchor while it is dragged, and after it lands", async () => {
    const source = editor.font.defaultSource;
    const location = editor.font.externalLocationForSource(source.id)!;
    const aacute = editor.font.recordForName("aacute" as GlyphName)!;
    const model = editor.glyphForId(aacute.id)!.renderModelAt(signal(location), signal(source.id));
    const seen: (number | undefined)[] = [];
    const subscription = effect(() => {
      seen.push(model.anchorsWithComponentsCell.value.find((a) => a.name === "bottom")?.x);
    });

    const a = editor.glyphForId(editor.font.recordForName("a" as GlyphName)!.id)!;
    const layer = a.layerForSource(source.id)!;
    const bottom = layer.anchors.find((anchor) => anchor.name === "bottom")!;
    const [position] = layer.positionsFor([{ kind: "anchor", id: bottom.id }]);
    layer.previewPositionPatch([{ ...position!, x: 300 }]);
    expect(model.anchorNamed("bottom")).toEqual({ name: "bottom", x: 300, y: 0 });

    layer.applyPositionPatch([{ ...position!, x: 320 }]);
    subscription.dispose();

    expect(seen.at(-1)).toBe(320);
    await compareAll();
  });

  it("stacks marks and takes the base's other anchors", () => {
    expect(editorAnchors("adotbelowacutetilde", editor.font.defaultSource.id)).toEqual([
      { name: "bottom", x: 250, y: -150 },
      { name: "ogonek", x: 420, y: 0 },
      { name: "top", x: 250, y: 850 },
    ]);
  });
});
