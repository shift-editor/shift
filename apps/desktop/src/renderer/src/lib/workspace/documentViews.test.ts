import { describe, expect, it } from "vitest";
import { asGlyphId } from "@shift/types";
import { DOCUMENT_VIEWS_LIMIT, DocumentViews } from "./documentViews";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("DocumentViews", () => {
  it("remembers each document's view separately", () => {
    const storage = memoryStorage();
    const views = new DocumentViews(() => storage);

    views.write("doc-1", { glyphId: asGlyphId("glyph_a") });
    views.write("doc-2", { glyphId: asGlyphId("glyph_b") });
    views.write("doc-1", {});

    const reopened = new DocumentViews(() => storage);
    expect(reopened.read("doc-1")).toEqual({});
    expect(reopened.read("doc-2")).toEqual({ glyphId: asGlyphId("glyph_b") });
    expect(reopened.read("doc-3")).toBeNull();
  });

  it(`keeps the ${DOCUMENT_VIEWS_LIMIT} most recently used documents`, () => {
    const storage = memoryStorage();
    const bounded = new DocumentViews(() => storage);
    for (let index = 0; index <= DOCUMENT_VIEWS_LIMIT; index++) {
      bounded.write(`doc-${index}`, { glyphId: asGlyphId(`glyph_${index}`) }, index);
    }

    expect(bounded.read("doc-0")).toBeNull();
    expect(bounded.read(`doc-${DOCUMENT_VIEWS_LIMIT}`)).toEqual({
      glyphId: asGlyphId(`glyph_${DOCUMENT_VIEWS_LIMIT}`),
    });
  });

  it("finds nothing when storage is unavailable", () => {
    const views = new DocumentViews(() => {
      throw new Error("storage blocked");
    });

    expect(() => views.write("doc-1", { glyphId: asGlyphId("glyph_a") })).not.toThrow();
    expect(views.read("doc-1")).toBeNull();
  });

  it("forgets malformed views without losing valid ones", () => {
    const storage = memoryStorage();
    storage.setItem(
      "shift.documentViews",
      JSON.stringify([
        { key: "doc-1", usedAt: 2, glyphId: "glyph_a" },
        { key: "doc-2", usedAt: 1, glyphId: "not-a-glyph-id" },
        { key: "doc-3", usedAt: "yesterday" },
        { key: "doc-4", usedAt: 1, camera: { zoom: 2 } },
      ]),
    );
    const views = new DocumentViews(() => storage);

    expect(views.read("doc-1")).toEqual({ glyphId: asGlyphId("glyph_a") });
    expect(["doc-2", "doc-3", "doc-4"].map((key) => views.read(key))).toEqual([null, null, null]);
  });
});
