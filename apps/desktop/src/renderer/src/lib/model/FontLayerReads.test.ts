import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { mintLayerId, mintSourceId, type GlyphName, type LayerId } from "@shift/types";
import { GlyphGeometry } from "@shift/glyph-state";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";

const MUTATOR_SANS = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

describe("Font reads exact authored layers from accepted workspace state", () => {
  let stack: WorkspaceStack;

  beforeEach(async () => {
    stack = createWorkspaceStack();
    await stack.openWorkspace(MUTATOR_SANS);
  });

  afterEach(() => stack.dispose());

  function layerFor(glyphName: string, sourceName: string): LayerId {
    const record = stack.font.recordForName(glyphName as GlyphName);
    const source = stack.font.sources.find((candidate) => candidate.name === sourceName);
    const layer = record?.layers.find((candidate) => candidate.sourceId === source?.id);
    if (!layer) throw new Error(`Expected ${glyphName} in ${sourceName}`);
    return layer.id;
  }

  it("resolves the requested root layer with direct component subtrees, in request order", async () => {
    const composite = layerFor("Aacute", "BoldWide");
    const plain = layerFor("B", "LightCondensed");

    const reads = await stack.font.resolveLayers([composite, plain, composite]);

    expect(reads.map(({ authored }) => authored.state.layerId)).toEqual([
      composite,
      plain,
      composite,
    ]);
    const [{ authored, resolved }] = reads;
    expect(resolved.components.map(({ id }) => id)).toEqual(
      authored.state.structure.components.map(({ id }) => id),
    );
    expect(resolved.components.length).toBeGreaterThan(0);
    for (const component of resolved.components) {
      expect(component.outline.svgPath).not.toBe("");
      expect(component.outline.bounds).toBeDefined();
      expect(resolved.outline.svgPath).toContain(component.outline.svgPath);
    }
  });

  it("rejects unknown layer identities", async () => {
    const known = layerFor("B", "LightCondensed");

    await expect(stack.font.readLayers([known, mintLayerId()])).rejects.toThrow();
    await expect(stack.font.resolveLayers([known, mintLayerId()])).rejects.toThrow();
  });

  it("does not load glyph models into the store", async () => {
    const layerId = layerFor("Aacute", "BoldWide");

    await stack.font.readLayers([layerId]);
    await stack.font.resolveLayers([layerId]);

    expect(stack.store.loadedGlyphs()).toEqual([]);
  });

  it("ignores an active gesture preview", async () => {
    const record = stack.font.recordForName("B" as GlyphName);
    if (!record) throw new Error("Expected B");
    const glyph = await stack.font.loadGlyph(record.id);
    const layerId = layerFor("B", "LightCondensed");
    const layer = glyph.layers.find((candidate) => candidate.layerId === layerId);
    const point = layer?.contours[0]?.points[0];
    if (!layer || !point) throw new Error("Expected a point in B");
    const before = await stack.font.resolveLayers([layerId]);

    layer.previewPositionPatch([{ kind: "point", id: point.id, x: point.x + 500, y: point.y }]);
    const [authored] = await stack.font.readLayers([layerId]);
    const [resolved] = await stack.font.resolveLayers([layerId]);

    expect(layer.point(point.id)?.x).toBe(point.x + 500);
    expect(GlyphGeometry.fromState(authored!.state).point(point.id)?.x).toBe(point.x);
    expect(resolved).toEqual(before[0]);
  });

  it("reads each glyph's layer in one source, with null where a glyph has none", async () => {
    const source = stack.font.sources.find(({ id }) =>
      stack.font.glyphRecords().some((glyph) => !glyph.layers.some((l) => l.sourceId === id)),
    );
    if (!source) throw new Error("Expected a source with sparse glyph layers");
    const glyphs = stack.font.glyphRecords();

    const layers = await stack.font.readLayersInSource(
      glyphs.map(({ id }) => id),
      source.id,
    );

    expect(layers.map((layer) => layer?.state.layerId ?? null)).toEqual(
      glyphs.map((glyph) => stack.font.layerIdFor(glyph.id, source.id)),
    );
    expect(layers).toContain(null);
    expect(layers.some((layer) => layer !== null)).toBe(true);
    await expect(stack.font.readLayersInSource([glyphs[0]!.id], mintSourceId())).rejects.toThrow(
      "is not in this font",
    );
  });
});
