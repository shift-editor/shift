import { describe, expect, it } from "vitest";
import {
  mintAxisId,
  mintGlyphId,
  mintLayerId,
  mintSourceId,
  type AxisId,
  type GlyphId,
  type GlyphName,
  type SourceId,
  type Unicode,
} from "@shift/types";
import type { WorkspaceSnapshot } from "@shared/workspace/protocol";
import { Font } from "./Font";
import { FontStore } from "./FontStore";
import { createWorkspaceStack } from "@/testing/workspaceStack";
import { axisLocationFromLocation } from "@/lib/variation/location";

const SNAPSHOT: WorkspaceSnapshot = {
  documentId: "11111111-2222-3333-4444-555555555555",
  metadata: { familyName: "Untitled Font" },
  metrics: { unitsPerEm: 2048, ascender: 1638, descender: -410 },
  glyphs: [
    {
      id: "glyph_A" as GlyphId,
      name: "A" as GlyphName,
      unicodes: [65 as Unicode],
      componentBaseGlyphIds: [],
      layers: [],
    },
  ],
  sources: [
    {
      id: "source-1" as SourceId,
      name: "Regular",
      location: { values: {} },
    },
  ],
  axes: [],
};

describe("Font projects the workspace snapshot", () => {
  it("is unloaded with default metrics while no workspace is open", () => {
    const font = new Font(new FontStore());

    expect(font.loaded).toBe(false);
    expect(font.metrics.unitsPerEm).toBe(1000);
    expect(font.glyphRecords()).toEqual([]);
  });

  it("follows a snapshot: loaded, metrics, metadata, directory, sources", () => {
    const store = new FontStore();
    const font = new Font(store);

    store.replaceWorkspace(SNAPSHOT);

    expect(font.loaded).toBe(true);
    expect(font.metrics.unitsPerEm).toBe(2048);
    expect(font.metadata.familyName).toBe("Untitled Font");
    const record = font.recordForName("A" as GlyphName);
    expect(record).not.toBeNull();
    expect(font.hasGlyph(record!.id)).toBe(true);
    expect(font.nameForUnicode(65 as Unicode)).toBe("A");
    expect(font.sources.map((source) => source.name)).toEqual(["Regular"]);
  });

  it("loadedCell flips reactively when the snapshot changes", () => {
    const store = new FontStore();
    const font = new Font(store);

    expect(font.loadedCell.value).toBe(false);

    store.replaceWorkspace(SNAPSHOT);

    expect(font.loadedCell.value).toBe(true);
  });

  it("resets to fallback font values when the workspace goes null", () => {
    const store = new FontStore(SNAPSHOT);
    const font = new Font(store);

    expect(font.loaded).toBe(true);

    store.replaceWorkspace(null);

    expect(font.loaded).toBe(false);
    expect(font.metrics.unitsPerEm).toBe(1000);
    const record = font.recordForName("A" as GlyphName);
    expect(record).toBeNull();
    expect(font.sources).toEqual([]);
  });

  it("an empty loaded font reports records, not the unloaded fallback", () => {
    const store = new FontStore({
      ...SNAPSHOT,
      glyphs: [],
    });
    const font = new Font(store);

    expect(font.loaded).toBe(true);
    expect(font.glyphRecords()).toEqual([]);
    expect(font.unicodes).toEqual([]);
  });
});

describe("font-level intents make the font variable", () => {
  it("createAxis and createSource project axes and sources without creating glyph layers", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const glyphId = mintGlyphId();
    await stack.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: { glyphId, name: "A" as GlyphName, unicodes: [65 as Unicode] },
      },
    ]);
    expect(stack.font.isVariable()).toBe(false);

    const weightAxisId = mintAxisId();
    await stack.editCoordinator.apply([
      {
        kind: "createAxis",
        createAxis: {
          axisId: weightAxisId,
          tag: "wght",
          name: "Weight",
          min: 100,
          default: 400,
          max: 900,
          hidden: false,
        },
      },
    ]);
    expect(stack.font.getAxes().map((axis) => axis.tag)).toEqual(["wght"]);
    expect(stack.font.isVariable()).toBe(true);

    const boldSourceId = mintSourceId();
    const applied = await stack.editCoordinator.apply([
      {
        kind: "createSource",
        createSource: {
          sourceId: boldSourceId,
          name: "Bold",
          location: { values: { [weightAxisId]: 700 } as Record<AxisId, number> },
        },
      },
    ]);
    const bold = stack.font.sources.find((source) => source.name === "Bold");
    expect(bold?.id).toBe(boldSourceId);
    expect(applied.sources?.find((source) => source.name === "Bold")?.id).toBe(boldSourceId);
    expect(applied.layers).toEqual([]);
    expect(stack.font.layer(glyphId, boldSourceId)).toBeNull();
  });

  it("createGlyphLayer projects sparse glyph-layer membership", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const glyphId = mintGlyphId();
    await stack.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: { glyphId, name: "A" as GlyphName, unicodes: [65 as Unicode] },
      },
    ]);

    const layerId = mintLayerId();
    const sourceId = stack.font.defaultSource.id;
    const applied = await stack.editCoordinator.apply([
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId, glyphId, sourceId },
      },
    ]);

    expect(applied.glyphs?.[0]?.layers).toEqual([{ id: layerId, sourceId }]);
    expect(stack.font.glyph(glyphId)?.layers).toEqual([{ id: layerId, sourceId }]);
  });

  it("createGlyph authors a default layer for fresh glyphs", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();

    const record = stack.font.createGlyph("A" as GlyphName);
    const source = stack.font.defaultSource;

    expect(record.layers).toHaveLength(1);
    expect(record.layers[0]?.sourceId).toBe(source.id);

    await stack.editCoordinator.settled();

    const committed = stack.font.glyph(record.id);
    expect(committed?.layers).toEqual(record.layers);

    const glyph = await stack.font.loadGlyph(record.id);
    expect(stack.font.layer(record.id, source.id)?.id).toBe(record.layers[0]?.id);
    expect(glyph.xAdvance).toBe(stack.font.defaultXAdvance);
  });

  it("preserves glyph object identity while record names change", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();

    const record = stack.font.createGlyph("A" as GlyphName);
    await stack.editCoordinator.settled();
    const glyph = await stack.font.loadGlyph(record.id);

    await stack.editCoordinator.apply([
      {
        kind: "updateGlyph",
        updateGlyph: {
          glyphId: record.id,
          newName: "A.alt" as GlyphName,
          newUnicodes: [0xe001 as Unicode],
        },
      },
    ]);

    expect(await stack.font.loadGlyph(record.id)).toBe(glyph);
    expect(glyph.name).toBe("A.alt");
    expect(glyph.unicode).toBe(0xe001);
  });

  it("exact sources without glyph layers have no live layer and do not render default geometry", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const glyphId = mintGlyphId();
    const defaultLayerId = mintLayerId();
    await stack.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: { glyphId, name: "A" as GlyphName, unicodes: [65 as Unicode] },
      },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: {
          layerId: defaultLayerId,
          glyphId,
          sourceId: stack.font.defaultSource.id,
        },
      },
      { kind: "setXAdvance", setXAdvance: { layerId: defaultLayerId, width: 640 } },
    ]);

    const axisId = mintAxisId();
    await stack.editCoordinator.apply([
      {
        kind: "createAxis",
        createAxis: {
          axisId,
          tag: "wght",
          name: "Weight",
          min: 100,
          default: 400,
          max: 900,
          hidden: false,
        },
      },
    ]);
    const sourceId = mintSourceId();
    await stack.editCoordinator.apply([
      {
        kind: "createSource",
        createSource: {
          sourceId,
          name: "Bold",
          location: { values: { [axisId]: 700 } as Record<AxisId, number> },
        },
      },
    ]);

    const glyph = await stack.font.loadGlyph(glyphId);
    expect(glyph.xAdvance).toBe(640);

    const bold = stack.font.source(sourceId);
    if (!bold) throw new Error("Expected created source");
    const location = axisLocationFromLocation(bold.location);
    const instance = stack.font.instance(glyph.id, location);
    if (!instance) throw new Error("Expected glyph instance");

    expect(stack.font.editableLayerAt(glyph.id, location)).toBeNull();
    expect(instance.xAdvance).toBe(0);
    expect(instance.geometry.allPoints).toEqual([]);
  });

  it("loads every authored layer in one glyph snapshot", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const glyphId = mintGlyphId();
    const defaultSourceId = stack.font.defaultSource.id;
    const defaultLayerId = mintLayerId();
    await stack.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: { glyphId, name: "A" as GlyphName, unicodes: [65 as Unicode] },
      },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId: defaultLayerId, glyphId, sourceId: defaultSourceId },
      },
    ]);

    const axisId = mintAxisId();
    await stack.editCoordinator.apply([
      {
        kind: "createAxis",
        createAxis: {
          axisId,
          tag: "wght",
          name: "Weight",
          min: 100,
          default: 400,
          max: 900,
          hidden: false,
        },
      },
    ]);
    const boldSourceId = mintSourceId();
    const boldLayerId = mintLayerId();
    await stack.editCoordinator.apply([
      {
        kind: "createSource",
        createSource: {
          sourceId: boldSourceId,
          name: "Bold",
          location: { values: { [axisId]: 700 } as Record<AxisId, number> },
        },
      },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId: boldLayerId, glyphId, sourceId: boldSourceId },
      },
    ]);

    const boldSource = stack.font.source(boldSourceId);
    if (!boldSource) throw new Error("Expected bold source");

    await stack.font.loadGlyph(glyphId);

    expect(stack.font.layer(glyphId, defaultSourceId)?.id).toBe(defaultLayerId);
    expect(stack.font.layer(glyphId, boldSource.id)?.id).toBe(boldLayerId);
  });

  it("rejects glyph loads for ids outside the current font", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();

    await expect(stack.font.loadGlyph(mintGlyphId())).rejects.toThrow("is not in the current font");
  });

  it("loads glyph batches in request order", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();

    const a = stack.font.createGlyph("A" as GlyphName);
    const b = stack.font.createGlyph("B" as GlyphName);
    await stack.editCoordinator.settled();

    const glyphs = await stack.font.loadGlyphs([b.id, a.id, b.id]);

    expect(glyphs.map((glyph) => glyph.id)).toEqual([b.id, a.id, b.id]);
  });
});
