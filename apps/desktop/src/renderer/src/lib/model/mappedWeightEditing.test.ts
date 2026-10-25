import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mintAxisMappingId } from "@shift/types";
import {
  externalAxisLocationFromLocation,
  externalAxisLocationFromRecord,
} from "@shift/editor/variation";
import { TestEditor } from "@/testing/TestEditor";

/**
 * Editor-driven variation coverage: external locations, axis mappings, and
 * mapped-weight interpolation as the editor shows them. Split from
 * `variation.test.ts`, which exercises the workspace stack alone.
 */
const MAPPED_WEIGHT_FIXTURE = resolve(process.cwd(), "../../fixtures/fonts/MappedWeight.glyphs");

it("maps external locations once across source creation, instances, and exact layers", async () => {
  const editor = new TestEditor();
  await editor.startSession();
  const glyph = editor.glyphForId(editor.glyphRecord!.id)!;
  editor.requireGlyphLayer().setXAdvance(300);
  await editor.settle();

  const axisId = editor.font.createAxis({
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
  await editor.settle();
  await editor.font.setAxisMappings([
    {
      id: mintAxisMappingId(),
      name: "Weight curve",
      inputs: [axisId],
      outputs: [axisId],
      points: [
        { input: { values: { [axisId]: 100 } }, output: { values: { [axisId]: 100 } } },
        { input: { values: { [axisId]: 400 } }, output: { values: { [axisId]: 400 } } },
        { input: { values: { [axisId]: 900 } }, output: { values: { [axisId]: 800 } } },
      ],
    },
  ]);

  const blackExternal = externalAxisLocationFromRecord({ [axisId]: 900 });
  const blackSourceId = editor.createSource("Black", blackExternal);
  await editor.settle();
  glyph.layerForSource(blackSourceId)!.setXAdvance(500);
  await editor.settle();

  const blackSource = editor.font.source(blackSourceId);
  if (!blackSource) throw new Error("Expected Black source");
  expect(blackSource.location.values[axisId]).toBeCloseTo(800);
  expect(editor.font.sourceAt(blackExternal)?.id).toBe(blackSourceId);
  expect(glyph.layerAt(blackExternal)?.sourceId).toBe(blackSourceId);

  const instanceId = editor.font.createNamedInstance({
    name: "Black",
    location: { values: { [axisId]: 900 } },
    postscriptName: "UntitledFont-Black",
  });
  await editor.settle();
  const instance = editor.font.namedInstances.find((candidate) => candidate.id === instanceId);
  if (!instance) throw new Error("Expected Black instance");

  editor.setSourceToDefault();
  editor.setExternalLocation(externalAxisLocationFromLocation(instance.location));
  expect(editor.activeSourceId).toBe(blackSourceId);
  expect(editor.sceneGlyphRenderModel?.xAdvance).toBe(500);

  editor.setSourceToDefault();
  editor.selectSource(blackSourceId);
  expect(editor.activeSourceId).toBe(blackSourceId);
  expect(editor.externalLocation.get(axisId)).toBeCloseTo(900);
  expect(editor.sceneGlyphRenderModel?.xAdvance).toBe(500);
});

describe("mapped weights retain design-space interpolation", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(MAPPED_WEIGHT_FIXTURE, "A");
  });

  it.each([
    [100, 30, 300, 700],
    [250, 58, 450, 750],
    [400, 86, 600, 800],
    [681.25, 123, 750, 850],
    [800, 160, 900, 900],
  ])(
    "renders weight %s with the mapped outline, advance, and metrics",
    (weight, x, advance, ascender) => {
      const axisId = editor.font.getAxes()[0]!.id;
      const model = editor.sceneGlyphRenderModel!;
      editor.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: weight }));

      expect(Math.max(...model.allPoints.map((point) => point.x))).toBeCloseTo(x);
      expect(model.xAdvance).toBeCloseTo(advance);
      expect(editor.font.metricsAtLocation(editor.externalLocation).ascender).toBeCloseTo(ascender);
    },
  );

  it("preserves mapped interpolation after Save As and a fresh reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "shift-mapped-weight-"));
    const saved = join(root, "Mapped.shift");
    try {
      await editor.saveAs(saved);
      await editor.closeSession();
      const reopened = new TestEditor();
      await reopened.openSession(saved, "A");
      const axisId = reopened.font.getAxes()[0]!.id;
      reopened.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 250 }));
      expect(reopened.sceneGlyphRenderModel!.xAdvance).toBeCloseTo(450);
      expect(
        Math.max(...reopened.sceneGlyphRenderModel!.allPoints.map((point) => point.x)),
      ).toBeCloseTo(58);
      expect(reopened.font.metricsAtLocation(reopened.externalLocation).ascender).toBeCloseTo(750);
      await reopened.closeSession();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refreshes an existing render model and metrics when mappings change", async () => {
    const axisId = editor.font.getAxes()[0]!.id;
    const model = editor.sceneGlyphRenderModel!;
    editor.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 681.25 }));
    expect(model.xAdvance).toBeCloseTo(750);
    const mapping = editor.font.getAxisMappings()[0]!;

    await editor.font.setAxisMappings([
      {
        ...mapping,
        points: mapping.points.map((point) => ({
          ...point,
          output: {
            values: {
              [axisId]:
                point.output.values[axisId]! <= 86
                  ? point.output.values[axisId]!
                  : 86 + (point.output.values[axisId]! - 86) * 2,
            },
          },
        })),
      },
    ]);

    expect(model.xAdvance).toBeCloseTo(900);
    expect(Math.max(...model.allPoints.map((point) => point.x))).toBeCloseTo(160);
    expect(editor.font.metricsAtLocation(editor.externalLocation).ascender).toBeCloseTo(900);
    await editor.undo();
    expect(model.xAdvance).toBeCloseTo(750);
    expect(editor.font.metricsAtLocation(editor.externalLocation).ascender).toBeCloseTo(850);
  });
});
