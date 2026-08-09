import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  mintAxisId,
  mintAxisLabelId,
  mintAxisMappingId,
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
import { signal } from "@/lib/signals/signal";
import { externalAxisLocationFromRecord } from "@/lib/variation/location";

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
  axisMappings: [],
  axisMappingBases: [],
  namedInstances: [],
};

describe("Font projects the workspace snapshot", () => {
  it("is unloaded with default metrics while no workspace is open", () => {
    const font = new Font({ store: new FontStore() });

    expect(font.loaded).toBe(false);
    expect(font.metrics.unitsPerEm).toBe(1000);
    expect(font.glyphRecords()).toEqual([]);
  });

  it("follows a snapshot: loaded, metrics, metadata, directory, sources", () => {
    const store = new FontStore();
    const font = new Font({ store });

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
    const font = new Font({ store });

    expect(font.loadedCell.value).toBe(false);

    store.replaceWorkspace(SNAPSHOT);

    expect(font.loadedCell.value).toBe(true);
  });

  it("resets to fallback font values when the workspace goes null", () => {
    const store = new FontStore({ workspace: SNAPSHOT });
    const font = new Font({ store });

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
      workspace: {
        ...SNAPSHOT,
        glyphs: [],
      },
    });
    const font = new Font({ store });

    expect(font.loaded).toBe(true);
    expect(font.glyphRecords()).toEqual([]);
    expect(font.unicodes).toEqual([]);
  });
});

describe("font-level intents make the font variable", () => {
  it("persists metadata replacement through the reactive font and undo ledger", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const original = stack.font.metadata;
    const originalMetrics = stack.font.metrics;
    const updated = {
      ...original,
      familyName: "Shift Dogfood Sans",
      styleName: "Text",
      versionMajor: 2,
      versionMinor: 5,
      designer: "Shift Type",
      license: "SIL Open Font License 1.1",
    };

    await stack.font.updateMetadata(updated);

    expect(stack.font.metadata).toEqual(updated);
    expect(stack.font.metadataCell.value).toEqual(updated);
    expect(stack.font.metrics).toEqual(originalMetrics);

    await stack.editCoordinator.undo();
    expect(stack.font.metadata).toEqual(original);
    expect(stack.font.metrics).toEqual(originalMetrics);

    await stack.editCoordinator.redo();
    expect(stack.font.metadata).toEqual(updated);
    expect(stack.font.metrics).toEqual(originalMetrics);
  });

  it("createAxis and createSource project axes and sources without creating glyph layers", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const glyphId = mintGlyphId();
    await stack.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: {
          glyphId,
          name: "A" as GlyphName,
          unicodes: [65 as Unicode],
        },
      },
    ]);
    expect(stack.font.isVariable()).toBe(false);

    const weightAxisId = mintAxisId();
    await stack.editCoordinator.apply([
      {
        kind: "createAxis",
        createAxis: {
          axis: continuousAxis(weightAxisId),
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
          location: {
            values: { [weightAxisId]: 700 } as Record<AxisId, number>,
          },
        },
      },
    ]);
    const bold = stack.font.sources.find((source) => source.name === "Bold");
    expect(bold?.id).toBe(boldSourceId);
    expect(applied.next?.sources?.find((source) => source.name === "Bold")?.id).toBe(boldSourceId);
    expect(applied.layers).toEqual([]);
    expect(
      stack.font.recordForId(glyphId)?.layers.some((layer) => layer.sourceId === boldSourceId),
    ).toBe(false);
  });

  it("new sources inherit complete metrics after adding an axis", async () => {
    const stack = createWorkspaceStack();
    await stack.openWorkspace(
      resolve(process.cwd(), "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace"),
    );
    const axisId = stack.font.createAxis({
      tag: "opsz",
      name: "Optical Size",
      role: "external",
      axisType: "continuous",
      minimum: 8,
      default: 14,
      maximum: 72,
      labels: [],
      hidden: false,
    });
    await stack.editCoordinator.settled();

    const sourceId = stack.font.createSource(
      "Bold",
      externalAxisLocationFromRecord({ [axisId]: 900 }),
    );
    await stack.editCoordinator.settled();

    const source = stack.font.sources.find((candidate) => candidate.id === sourceId);
    expect(source?.metricValues).toHaveLength(stack.font.metricDefinitions.length);
  });

  it("createGlyphLayer projects sparse glyph-layer membership", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const glyphId = mintGlyphId();
    await stack.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: {
          glyphId,
          name: "A" as GlyphName,
          unicodes: [65 as Unicode],
        },
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

    expect(applied.next?.glyphs?.[0]?.layers).toEqual([{ id: layerId, sourceId }]);
    expect(stack.font.recordForId(glyphId)?.layers).toEqual([{ id: layerId, sourceId }]);
  });

  it("projects mapping edits and evaluates them in Rust", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const axisId = stack.font.createAxis({
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
    await stack.editCoordinator.settled();

    const mappingId = mintAxisMappingId();
    await stack.font.setAxisMappings([
      {
        id: mappingId,
        name: "Weight curve",
        inputs: [axisId],
        outputs: [axisId],
        points: [
          mappingPoint(axisId, 100, 100),
          mappingPoint(axisId, 400, 400),
          mappingPoint(axisId, 900, 800),
        ],
      },
    ]);
    expect(stack.font.getAxisMappings().map((mapping) => mapping.id)).toEqual([mappingId]);
    expect(
      stack.client.workspaceCell.peek()?.axisMappingBases.map((basis) => basis.mappingId),
    ).toEqual([mappingId]);
    const mapped = await stack.font.mapLocation({
      values: { [axisId]: 900 } as Record<AxisId, number>,
    });
    expect(mapped.values[axisId]).toBeCloseTo(800);

    stack.font.deleteAxis(axisId);
    await stack.editCoordinator.settled();
    expect(stack.font.getAxes()).toEqual([]);
    expect(stack.font.getAxisMappings()).toEqual([]);

    await stack.editCoordinator.undo();
    expect(stack.font.getAxes().map((axis) => axis.id)).toEqual([axisId]);
    expect(stack.font.getAxisMappings().map((mapping) => mapping.id)).toEqual([mappingId]);

    await stack.editCoordinator.undo();
    expect(stack.font.getAxisMappings()).toEqual([]);
  });

  it("projects stable axis labels and explicit named instances", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const labelId = mintAxisLabelId();
    const axisId = stack.font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [
        {
          id: labelId,
          name: "Bold",
          value: 700,
          elidable: false,
        },
      ],
      hidden: false,
    });
    await stack.editCoordinator.settled();

    const instanceId = stack.font.createNamedInstance({
      name: "Bold",
      location: { values: { [axisId]: 700 } as Record<AxisId, number> },
      postscriptName: "UntitledFont-Bold",
    });
    await stack.editCoordinator.settled();

    expect(stack.font.getAxes()[0]?.labels[0]?.id).toBe(labelId);
    expect(stack.font.namedInstances).toEqual([
      {
        id: instanceId,
        name: "Bold",
        location: { values: { [axisId]: 700 } },
        postscriptName: "UntitledFont-Bold",
      },
    ]);

    await stack.font.setAxisMappings([
      {
        id: mintAxisMappingId(),
        name: "Weight curve",
        inputs: [axisId],
        outputs: [axisId],
        points: [
          mappingPoint(axisId, 100, 100),
          mappingPoint(axisId, 400, 400),
          mappingPoint(axisId, 900, 800),
        ],
      },
    ]);
    expect(stack.font.namedInstances[0]?.location.values[axisId]).toBe(700);

    stack.font.deleteNamedInstance(instanceId);
    await stack.editCoordinator.settled();
    expect(stack.font.namedInstances).toEqual([]);

    await stack.editCoordinator.undo();
    expect(stack.font.namedInstances[0]?.id).toBe(instanceId);
  });

  it("createGlyph authors a default layer for fresh glyphs", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();

    const record = stack.font.createGlyph("A" as GlyphName);
    const source = stack.font.defaultSource;

    expect(record.layers).toHaveLength(1);
    expect(record.layers[0]?.sourceId).toBe(source.id);

    await stack.editCoordinator.settled();

    const committed = stack.font.recordForId(record.id);
    expect(committed?.layers).toEqual(record.layers);

    const glyph = await stack.font.loadGlyph(record.id);
    const layer = glyph.layerForSource(source.id);
    if (!layer) throw new Error("Expected default glyph layer");

    expect(glyph.entry).toEqual({
      id: record.id,
      name: record.name,
      unicodes: record.unicodes,
    });
    expect(glyph.layers).toEqual([layer]);
    expect(layer.id).toBe(record.layers[0]?.id);
    expect(glyph.layerForId(layer.id)).toBe(layer);
    expect(glyph.layerAt(externalAxisLocationFromRecord(source.location.values))).toBe(layer);
    expect(glyph.xAdvance).toBe(stack.font.defaultXAdvance);
    expect(glyph.allPoints).toEqual([]);
  });

  it("preserves glyph object identity while record names change", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();

    const record = stack.font.createGlyph("A" as GlyphName);
    await stack.editCoordinator.settled();
    const glyph = await stack.font.loadGlyph(record.id);
    const layers = glyph.layers;

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
    expect(glyph.entry.name).toBe("A.alt");
    expect(glyph.name).toBe("A.alt");
    expect(glyph.unicode).toBe(0xe001);
    expect(glyph.layers).toEqual(layers);
    expect(glyph.layers[0]).toBe(layers[0]);
  });

  it("exact sources without glyph layers have no live layer and use projected fallback geometry", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const glyphId = mintGlyphId();
    const defaultLayerId = mintLayerId();
    await stack.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: {
          glyphId,
          name: "A" as GlyphName,
          unicodes: [65 as Unicode],
        },
      },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: {
          layerId: defaultLayerId,
          glyphId,
          sourceId: stack.font.defaultSource.id,
        },
      },
      {
        kind: "setXAdvance",
        setXAdvance: { layerId: defaultLayerId, width: 640 },
      },
    ]);

    const axisId = mintAxisId();
    await stack.editCoordinator.apply([
      {
        kind: "createAxis",
        createAxis: {
          axis: continuousAxis(axisId),
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
    const location = externalAxisLocationFromRecord(bold.location.values);
    const renderModel = glyph.renderModelAt(signal(location));

    expect(glyph.layerAt(location)).toBeNull();
    expect(glyph.geometryAt(location).xAdvance).toBe(640);
    expect(renderModel.xAdvance).toBe(640);
    expect(renderModel.allPoints).toEqual([]);
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
        createGlyph: {
          glyphId,
          name: "A" as GlyphName,
          unicodes: [65 as Unicode],
        },
      },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: {
          layerId: defaultLayerId,
          glyphId,
          sourceId: defaultSourceId,
        },
      },
    ]);

    const axisId = mintAxisId();
    await stack.editCoordinator.apply([
      {
        kind: "createAxis",
        createAxis: {
          axis: continuousAxis(axisId),
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
        createGlyphLayer: {
          layerId: boldLayerId,
          glyphId,
          sourceId: boldSourceId,
        },
      },
    ]);

    const boldSource = stack.font.source(boldSourceId);
    if (!boldSource) throw new Error("Expected bold source");

    const glyph = await stack.font.loadGlyph(glyphId);

    expect(glyph.layers.map((layer) => layer.id)).toEqual(
      stack.font.recordForId(glyph.id)?.layers.map((layer) => layer.id),
    );
    expect(glyph.layerForSource(defaultSourceId)?.id).toBe(defaultLayerId);
    expect(glyph.layerForSource(boldSource.id)?.id).toBe(boldLayerId);
    expect(glyph.layerForId(defaultLayerId)?.sourceId).toBe(defaultSourceId);
    expect(glyph.layerForId(boldLayerId)?.sourceId).toBe(boldSourceId);
    expect(glyph.primaryGeometryForFont).toBe(glyph.layerForSource(defaultSourceId)?.geometry);
    expect(glyph.layerAt(externalAxisLocationFromRecord(boldSource.location.values))?.id).toBe(
      boldLayerId,
    );
    const locationCell = signal(externalAxisLocationFromRecord(boldSource.location.values));
    expect(glyph.geometryAt(locationCell.peek())).toBe(glyph.layerForId(boldLayerId)?.geometry);
    expect(glyph.renderModelAt(locationCell)).toBe(glyph.renderModelAt(locationCell));
  });

  it("loads an authored-empty glyph as a complete stable object", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();
    const glyphId = mintGlyphId();

    await stack.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: {
          glyphId,
          name: "empty" as GlyphName,
          unicodes: [],
        },
      },
    ]);

    const glyph = await stack.font.loadGlyph(glyphId);

    expect(glyph.layers).toEqual([]);
    expect(glyph.allPoints).toEqual([]);
    expect(glyph.xAdvance).toBe(0);
    expect(glyph.geometryAt(stack.font.defaultLocation()).allPoints).toEqual([]);
    expect(await stack.font.loadGlyph(glyphId)).toBe(glyph);
  });

  it("preserves glyph identity while authored layer membership changes", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();

    const record = stack.font.createGlyph("A" as GlyphName);
    await stack.editCoordinator.settled();
    const glyph = await stack.font.loadGlyph(record.id);
    const axisId = mintAxisId();
    const sourceId = mintSourceId();
    const layerId = mintLayerId();

    await stack.editCoordinator.apply([
      { kind: "createAxis", createAxis: { axis: continuousAxis(axisId) } },
      {
        kind: "createSource",
        createSource: {
          sourceId,
          name: "Bold",
          location: { values: { [axisId]: 700 } as Record<AxisId, number> },
        },
      },
      { kind: "createGlyphLayer", createGlyphLayer: { layerId, glyphId: glyph.id, sourceId } },
    ]);

    expect(await stack.font.loadGlyph(glyph.id)).toBe(glyph);
    expect(glyph.layerForSource(sourceId)?.id).toBe(layerId);
    expect(glyph.layers.map((layer) => layer.id)).toEqual(
      stack.font.recordForId(glyph.id)?.layers.map((layer) => layer.id),
    );
  });

  it("rejects glyph loads for ids outside the current font", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();

    await expect(stack.font.loadGlyph(mintGlyphId())).rejects.toThrow("is not in the current font");
  });

  it("creates new glyph identities after workspace replacement", async () => {
    const stack = createWorkspaceStack();
    await stack.createWorkspace();

    const record = stack.font.createGlyph("A" as GlyphName);
    await stack.editCoordinator.settled();
    const glyph = await stack.font.loadGlyph(record.id);
    const snapshot = stack.store.workspaceCell.peek();
    if (!snapshot) throw new Error("Expected workspace snapshot");

    stack.store.replaceWorkspace(snapshot);

    expect(await stack.font.loadGlyph(record.id)).not.toBe(glyph);
  });

  it("uses exact-source component transforms when source component IDs differ", async () => {
    const stack = createWorkspaceStack();
    await stack.openWorkspace(
      resolve(process.cwd(), "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace"),
    );
    const record = stack.font.recordForName("Aacute" as GlyphName);
    if (!record) throw new Error("Expected Aacute fixture glyph");
    const source = stack.font.sources.find((candidate) => candidate.name === "BoldWide");
    if (!source) throw new Error("Expected BoldWide fixture source");
    const glyph = await stack.font.loadGlyph(record.id);
    const locationCell = signal(stack.font.defaultLocation());
    const activeSourceIdCell = signal<SourceId | null>(source.id);
    const renderModel = glyph.renderModelAt(locationCell, activeSourceIdCell);
    const exactGeometry = glyph.geometryForSource(source.id);
    const directComponents = renderModel.components.filter(
      (component) => component.parentPath.length === 0,
    );

    expect(directComponents.map((component) => component.componentId)).not.toEqual(
      exactGeometry.components.map((component) => component.id),
    );
    expect(directComponents.map((component) => component.transform)).toEqual(
      exactGeometry.components.map((component) => component.matrix),
    );
  });

  it("measures a pure component glyph while keeping root controls empty", async () => {
    const stack = createWorkspaceStack();
    await stack.openWorkspace(resolve(process.cwd(), "../../fixtures/fonts/Homenaje.glyphs"));
    const record = stack.font.recordForName("Aacute" as GlyphName);
    if (!record) throw new Error("Expected Aacute fixture glyph");
    const glyph = await stack.font.loadGlyph(record.id);

    for (const componentGlyphId of record.componentBaseGlyphIds) {
      const componentGlyph = stack.store.glyphForId(componentGlyphId);
      if (!componentGlyph) throw new Error(`Expected loaded component glyph ${componentGlyphId}`);

      expect(await stack.font.loadGlyph(componentGlyphId)).toBe(componentGlyph);
    }

    const renderModel = glyph.renderModelAt(signal(stack.font.defaultLocation()));

    expect(renderModel.contours.filter((contour) => contour.component === null)).toEqual([]);
    expect(renderModel.components).toHaveLength(2);
    expect(renderModel.contours.length).toBeGreaterThan(0);
    expect(renderModel.contours.every((contour) => contour.component !== null)).toBe(true);
    const componentContours = renderModel.components.flatMap((component) => component.contours);
    expect(componentContours).toHaveLength(renderModel.contours.length);
    for (let index = 0; index < componentContours.length; index++) {
      expect(renderModel.contours[index]).toBe(componentContours[index]);
    }
    expect(renderModel.xAdvance).toBe(483);
    expect(renderModel.sidebearings).toEqual({ lsb: 20, rsb: 20 });
  });
});

function continuousAxis(axisId: AxisId) {
  return {
    id: axisId,
    tag: "wght",
    name: "Weight",
    role: "external",
    axisType: "continuous",
    minimum: 100,
    default: 400,
    maximum: 900,
    labels: [],
    hidden: false,
  };
}

function mappingPoint(axisId: AxisId, input: number, output: number) {
  return {
    input: { values: { [axisId]: input } as Record<AxisId, number> },
    output: { values: { [axisId]: output } as Record<AxisId, number> },
  };
}
