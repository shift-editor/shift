import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { byName, type GlyphName } from "@shift/types";
import { anchorKind } from "@shift/editor/model";
import { signal } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";

const FIXTURE = resolve(process.cwd(), "../../fixtures/fonts/AnchorPropagation.glyphs");

describe("composites show their components' anchors", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await new TestEditor().openSession(FIXTURE, "a");
    for (const record of editor.font.glyphRecords()) await editor.font.loadGlyph(record.id);
  });

  /** The anchors of a glyph at the light master, sorted by name. */
  function anchorsOf(glyphName: string): { name: string; x: number; y: number }[] {
    const source = editor.font.defaultSource;
    const record = editor.font.recordForName(glyphName as GlyphName)!;
    const model = editor
      .glyphForId(record.id)!
      .renderModelAt(signal(editor.font.externalLocationForSource(source.id)!), signal(source.id));
    return [...model.anchorsWithComponents].map(({ name, x, y }) => ({ name, x, y })).sort(byName);
  }

  it("stacks marks and takes the base's other anchors", () => {
    expect(anchorsOf("adotbelowacutetilde")).toEqual([
      { name: "bottom", x: 250, y: -150 },
      { name: "ogonek", x: 420, y: 0 },
      { name: "top", x: 250, y: 850 },
    ]);
  });

  it("swaps top and bottom through a vertically flipped component", () => {
    expect(anchorsOf("a.flip")).toEqual([
      { name: "bottom", x: 250, y: 0 },
      { name: "ogonek", x: 420, y: 500 },
      { name: "top", x: 250, y: 500 },
    ]);
  });

  it("lets a later component's anchor replace an earlier one's", () => {
    expect(anchorsOf("f_i")).toEqual([
      { name: "bottom", x: 425, y: 0 },
      { name: "top", x: 425, y: 500 },
    ]);
  });
});

describe("anchor names read as export reads them", () => {
  it("tells marks, bases, ligatures, carets, and cursive anchors apart", () => {
    expect(anchorKind("_top")).toEqual({ kind: "mark", group: "top" });
    expect(anchorKind("top")).toEqual({ kind: "base", group: "top" });
    expect(anchorKind("top_2")).toEqual({ kind: "ligature", group: "top", index: 2 });
    expect(anchorKind("caret_1")).toEqual({ kind: "caret", index: 1 });
    expect(anchorKind("exit")).toEqual({ kind: "exit" });
    expect(anchorKind("_top_1")).toEqual({ kind: "invalid" });
  });
});
