import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  asGlyphId,
  asSourceId,
  type SaveAction,
  type SavePreviewStatus,
  type SaveStatus,
  type SourceReadiness,
} from "@shift/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPackageFixture, type PackageFixture } from "./testing/sourcePackage";

const singleSource = "singleSource" satisfies SourceReadiness;
const missingSourceLayers = "missingSourceLayers" satisfies SourceReadiness;
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
    expect(report).toMatchObject({ revision: 1, canonicalPaths: ["font.json"] });

    expect(pkg.document.save(pkg.path)).toMatchObject({ status: saved });
    expect(pkg.reopen().fontInfo()).toMatchObject({
      familyName: "Test Sans Text",
      unitsPerEm: 2048,
    });
  });

  it("renames component bases by stable glyph id", () => {
    const report = pkg.document.renameGlyph(pkg.glyphId("glyph_A"), "A.base");

    expect(report).toMatchObject({
      glyphId: asGlyphId("glyph_A"),
      glyphName: "A.base",
      variableReadiness: singleSource,
    });
    expect(report.impact.canonicalPaths).toEqual([
      "glyphs/glyph_A.json",
      "glyphs/glyph_Aacute.json",
    ]);
    expect(pkg.glyph("glyph_Aacute")).toMatchObject({
      componentBaseGlyphNames: ["A.base"],
    });
  });

  it("reports source readiness while filling sparse source layers", () => {
    const source = pkg.document.createSource("Bold", 900);
    expect(source).toMatchObject({
      sourceId: asSourceId("source_Bold"),
      variableReadiness: missingSourceLayers,
    });

    const layer = pkg.document.createGlyphSourceLayer(pkg.glyphId("glyph_A"), source.sourceId, 700);
    expect(layer).toMatchObject({
      glyphId: asGlyphId("glyph_A"),
      variableReadiness: missingSourceLayers,
    });
    expect(layer.impact.canonicalPaths).toEqual(["glyphs/glyph_A.json"]);
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
