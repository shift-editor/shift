import { describe, expect, it } from "vitest";
import type { GlyphCatalogRenderer } from "@/types/glyphCatalogRenderer";
import { selectGlyphCatalogRenderer } from "./selectGlyphCatalogRenderer";

const slugRenderer: GlyphCatalogRenderer = {
  kind: "slug",
  update() {},
  destroy() {},
};
const svgRenderer: GlyphCatalogRenderer = {
  kind: "svg",
  update() {},
  destroy() {},
};

describe("glyph catalog renderer selection", () => {
  it("keeps Slug when WebGPU initialization succeeds", async () => {
    const selection = await selectGlyphCatalogRenderer(
      new AbortController().signal,
      async () => slugRenderer,
      () => svgRenderer,
    );

    expect(selection).toEqual({ kind: "slug", renderer: slugRenderer });
  });

  it("selects SVG when Slug initialization fails", async () => {
    const selection = await selectGlyphCatalogRenderer(
      new AbortController().signal,
      async () => {
        throw new Error("WebGPU unavailable");
      },
      () => svgRenderer,
    );

    expect(selection).toEqual({ kind: "svg", renderer: svgRenderer });
  });
});
