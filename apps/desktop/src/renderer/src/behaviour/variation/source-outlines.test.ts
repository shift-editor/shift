import { beforeEach, describe, expect, it } from "vitest";
import type { SourceId } from "@shift/types";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

// Adding Bold makes it the active source, which is never outlined.
const editor = useTestEditor({ axes: [WEIGHT], sources: { Bold: { wght: 700 } } });
let regular: SourceId;

beforeEach(() => {
  const source = editor.source("Regular");
  if (!source) throw new Error("Expected the default source");
  regular = source.id;
});

describe("source outlines drawn around the glyph", () => {
  it("draws a source's outline once it is turned on from its row", () => {
    expect(editor.drawnOutlineTargets()).toEqual([]);

    editor.toggleSourceOutline("Regular");

    expect(editor.drawnOutlineTargets()).toEqual([{ kind: "source", sourceId: regular }]);
  });

  it("stops drawing a source's outline once the source is deleted", async () => {
    await editor.addSource("Black", { wght: 900 });
    editor.clickSource("Bold");
    editor.toggleSourceOutline("Black");
    expect(editor.drawnOutlineTargets()).toHaveLength(1);

    await editor.deleteSource("Black");

    expect(editor.drawnOutlineTargets()).toEqual([]);
  });

  it("hides every outline while the Hand is active", () => {
    editor.toggleSourceOutline("Regular");

    editor.selectTool("hand");
    expect(editor.drawnOutlineTargets()).toEqual([]);

    editor.selectTool("select");
    expect(editor.drawnOutlineTargets()).toEqual([{ kind: "source", sourceId: regular }]);
  });

  it("draws a source being edited until it is hidden from its row", () => {
    editor.toggleAllSourcesForEditing();
    expect(editor.drawnOutlineTargets()).toEqual([{ kind: "source", sourceId: regular }]);

    editor.toggleSourceOutline("Regular");
    expect(editor.drawnOutlineTargets()).toEqual([]);

    editor.collapseEditingSources();
    editor.toggleAllSourcesForEditing();
    expect(editor.drawnOutlineTargets()).toEqual([{ kind: "source", sourceId: regular }]);
  });
});
