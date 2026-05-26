import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  asGlyphId,
  asSourceId,
  type GlyphRemovalStrategy,
  type MasterLayerWorkStatus,
  type OpenAction,
  type OpenPreviewStatus,
  type SaveAction,
  type SavePreviewStatus,
  type SaveStatus,
  type SourceReadiness,
} from "@shift/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPackageFixture, type PackageFixture } from "./testing/sourcePackage";

const singleSource = "singleSource" satisfies SourceReadiness;
const missingSourceLayers = "missingSourceLayers" satisfies SourceReadiness;
const removeComponentUses = "removeComponentUses" satisfies GlyphRemovalStrategy;
const missingLayers = "missingLayers" satisfies MasterLayerWorkStatus;
const readyToOpen = "ready" satisfies OpenPreviewStatus;
const load = "load" satisfies OpenAction;
const blockedByRecovery = "blockedByRecovery" satisfies OpenPreviewStatus;
const block = "block" satisfies OpenAction;
const saved = "saved" satisfies SaveStatus;
const blockedByExternalChanges = "blockedByExternalChanges" satisfies SavePreviewStatus;
const resolveExternalChanges = "resolveExternalChanges" satisfies SaveAction;

describe("source document persistence", () => {
  let pkg: PackageFixture;

  beforeEach(() => {
    pkg = createPackageFixture();
  });

  afterEach(() => {
    pkg.dispose();
  });

  it("persists metadata edits and reopens the saved values", () => {
    const report = pkg.document.updateFontInfo("Test Sans Text", 2048);
    expect(report).toMatchObject({ revision: 1, changeCount: 1 });

    expect(pkg.document.save(pkg.path)).toMatchObject({ status: saved });
    expect(pkg.reopen().fontInfo()).toMatchObject({
      familyName: "Test Sans Text",
      unitsPerEm: 2048,
    });
  });

  it("previews clean packages before opening editable data", () => {
    expect(pkg.document.previewOpen(pkg.path)).toMatchObject({
      status: readyToOpen,
      primaryAction: load,
      stagedRecoveryCount: 0,
    });

    expect(pkg.document.recoverAndOpen(pkg.path)).toMatchObject({
      recoveredTransactionCount: 0,
      glyphCount: 2,
      sourceCount: 1,
    });
  });

  it("blocks packages with unresolved staged transactions before opening", () => {
    mkdirSync(join(pkg.path, ".shift-txn", "broken-transaction"), {
      recursive: true,
    });

    expect(pkg.document.previewOpen(pkg.path)).toMatchObject({
      status: blockedByRecovery,
      primaryAction: block,
      stagedRecoveryCount: 1,
      unrecoverableRecoveryCount: 1,
      issueCount: 1,
    });
    expect(() => pkg.reopen()).toThrow();
  });

  it("renames component bases by stable glyph id", () => {
    const report = pkg.document.renameGlyph(pkg.glyphId("glyph_A"), "A.base");

    expect(report).toMatchObject({
      glyphId: asGlyphId("glyph_A"),
      glyphName: "A.base",
      variableReadiness: singleSource,
    });
    expect(pkg.glyph("glyph_Aacute")).toMatchObject({
      componentBaseGlyphNames: ["A.base"],
    });
  });

  it("tracks which glyphs still need a layer after adding a master", () => {
    const source = pkg.document.createSource("Bold", 900);
    expect(source).toMatchObject({
      sourceId: asSourceId("source_Bold"),
      variableReadiness: missingSourceLayers,
    });

    expect(pkg.document.masterLayerWorklist()).toMatchObject({
      variableReadiness: missingSourceLayers,
      sourceCount: 2,
      glyphCount: 2,
      sourceNeedingWorkCount: 1,
      missingLayerCount: 2,
      items: [
        {
          sourceId: asSourceId("source_Bold"),
          sourceName: "Bold",
          status: missingLayers,
          missingLayerCount: 2,
          missingGlyphLayers: [
            {
              glyphId: asGlyphId("glyph_A"),
              glyphName: "A",
              sourceId: asSourceId("source_Bold"),
            },
            {
              glyphId: asGlyphId("glyph_Aacute"),
              glyphName: "Aacute",
              sourceId: asSourceId("source_Bold"),
            },
          ],
        },
      ],
    });

    const layer = pkg.document.createGlyphSourceLayer(pkg.glyphId("glyph_A"), source.sourceId, 700);
    expect(layer).toMatchObject({
      glyphId: asGlyphId("glyph_A"),
      variableReadiness: missingSourceLayers,
    });
    expect(layer.missingLayerCount).toBeGreaterThan(0);
    expect(pkg.document.masterLayerWorklist()).toMatchObject({
      missingLayerCount: 1,
      items: [
        {
          sourceId: asSourceId("source_Bold"),
          missingLayerCount: 1,
          missingGlyphLayers: [
            {
              glyphId: asGlyphId("glyph_Aacute"),
              glyphName: "Aacute",
            },
          ],
        },
      ],
    });
  });

  it("removes a base glyph by applying the component-use strategy", () => {
    const preview = pkg.document.previewGlyphRemoval(pkg.glyphId("glyph_A"));

    expect(preview).toMatchObject({
      glyphId: asGlyphId("glyph_A"),
      glyphName: "A",
      canRemoveDirectly: false,
      requiresStrategy: true,
      componentUseCount: 1,
      componentUserCount: 1,
      validStrategies: [removeComponentUses],
      componentUsers: [
        {
          glyphId: asGlyphId("glyph_Aacute"),
          glyphName: "Aacute",
          componentCount: 1,
        },
      ],
    });

    const edit = pkg.document.removeGlyphAndComponentUses(pkg.glyphId("glyph_A"));

    expect(edit).toMatchObject({
      glyphId: asGlyphId("glyph_A"),
      glyphName: "A",
      removedComponentUseCount: 1,
      variableReadiness: singleSource,
      componentUsers: [
        {
          glyphId: asGlyphId("glyph_Aacute"),
          glyphName: "Aacute",
          componentCount: 1,
        },
      ],
    });
    expect(edit.impact.changeCount).toBe(2);
    expect(pkg.glyph("glyph_A")).toBeUndefined();
    expect(pkg.glyph("glyph_Aacute")).toMatchObject({
      componentBaseGlyphNames: [],
    });
  });

  it("blocks save when a canonical file changed outside the document", () => {
    pkg.document.renameGlyph(pkg.glyphId("glyph_A"), "A.base");
    writeFileSync(join(pkg.path, "glyphs", "glyph_A.json"), '{"externally":"modified"}\n');

    expect(pkg.document.previewSave(pkg.path)).toMatchObject({
      status: blockedByExternalChanges,
      primaryAction: resolveExternalChanges,
      conflictCount: 1,
    });
  });
});
