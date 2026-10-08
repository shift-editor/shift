import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { mintAxisId, mintLayerId, mintSourceId, type GlyphName } from "@shift/types";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";
import { ShiftFontReader } from "./ShiftFontReader";

const MUTATOR_SANS = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

describe("ShiftFontReader serves public reads of accepted font state", () => {
  let stack: WorkspaceStack;
  let reader: ShiftFontReader;

  beforeEach(async () => {
    stack = createWorkspaceStack();
    await stack.openWorkspace(MUTATOR_SANS);
    reader = new ShiftFontReader(stack.font, "workspace");
  });

  afterEach(() => stack.dispose());

  it("addresses layers by the IDs glyphs advertise", async () => {
    const glyph = reader.getGlyph({ name: "Aacute" as GlyphName });
    const [{ layerId, sourceId }] = glyph.layers;

    const authored = await reader.getLayer(layerId!);
    const resolved = await reader.resolveLayer(layerId!);
    const rendered = await reader.renderLayer(layerId!, { overlays: { points: true } });

    expect([authored.layerId, resolved.layerId, rendered.layerId]).toEqual([
      layerId,
      layerId,
      layerId,
    ]);
    expect(authored.sourceId).toBe(sourceId);
    expect(rendered.guides.fontMetrics.ascender).toBe(
      stack.font.metricsForSource(sourceId!).ascender,
    );
  });

  it("rejects unknown layers", async () => {
    await expect(reader.getLayer(mintLayerId())).rejects.toThrow();
    await expect(reader.resolveLayer(mintLayerId())).rejects.toThrow();
    await expect(reader.renderLayer(mintLayerId())).rejects.toThrow();
  });

  it("nests each glyph's layer in a source, or null where the glyph has none", async () => {
    const source = stack.font.sources[0]!;
    const page = await reader.listGlyphs({ limit: 100, sourceId: source.id });

    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      const advertised = item.layers.find((layer) => layer.sourceId === source.id);
      expect(item.layer?.layerId ?? null).toBe(advertised?.layerId ?? null);
    }
    await expect(reader.listGlyphs({ sourceId: mintSourceId() })).rejects.toThrow(
      "is not in this font",
    );
  });

  it("resolves locations through the font's designspace", () => {
    const font = stack.font;
    const source = font.sources.find(({ id }) => id !== font.defaultSource.id)!;
    const sourceLocation = font.externalLocationForSource(source.id)!;
    const coordinates = font.designspace.coordinates(sourceLocation);

    const resolved = reader.resolveLocation(coordinates);

    expect(resolved.externalLocation).toEqual(coordinates);
    expect(resolved.sourceId).toBe(source.id);
    expect(resolved.metrics).toEqual(font.metricsAtLocation(sourceLocation));
    expect(reader.resolveLocation([]).externalLocation).toEqual(
      font.designspace.coordinates(font.defaultLocation()),
    );
    expect(() => reader.resolveLocation([{ axisId: mintAxisId(), value: 1 }])).toThrow(
      "Unknown axis",
    );
  });
});
