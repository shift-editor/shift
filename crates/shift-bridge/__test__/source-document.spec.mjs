import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const require = createRequire(import.meta.url);
const { ShiftSourceDocument } = require("../index.js");

describe("source document persistence", () => {
  let tempDir;
  let packagePath;
  let document;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shift-package-"));
    packagePath = join(tempDir, "TestSans.shift");
    document = new ShiftSourceDocument();
    document.initializeSaved(packagePath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function glyph(id) {
    return document.glyphs().find((record) => record.id === id);
  }

  it("saves and reopens metadata edits", () => {
    expect(document.updateFontInfo("Test Sans Text", 2048)).toMatchObject({
      revision: 1,
      changeCount: 1,
      canonicalPaths: ["font.json"],
    });

    expect(document.save(packagePath)).toMatchObject({ status: "saved" });

    const reopened = new ShiftSourceDocument();
    reopened.open(packagePath);
    expect(reopened.fontInfo()).toMatchObject({
      familyName: "Test Sans Text",
      unitsPerEm: 2048,
    });
  });

  it("previews clean packages before opening editable data", () => {
    expect(document.previewOpen(packagePath)).toMatchObject({
      status: "ready",
      primaryAction: "load",
      stagedRecoveryCount: 0,
    });

    expect(document.recoverAndOpen(packagePath)).toMatchObject({
      recoveredTransactionCount: 0,
      glyphCount: 2,
      sourceCount: 1,
    });
  });

  it("blocks packages with unresolved staged transactions before opening", () => {
    mkdirSync(join(packagePath, ".shift-txn", "broken-transaction"), {
      recursive: true,
    });

    expect(document.previewOpen(packagePath)).toMatchObject({
      status: "blockedByRecovery",
      primaryAction: "block",
      stagedRecoveryCount: 1,
      unrecoverableRecoveryCount: 1,
      issueCount: 1,
    });
    expect(() => {
      const reopened = new ShiftSourceDocument();
      reopened.open(packagePath);
    }).toThrow();
  });

  it("creates glyphs with narrow source-file impact", () => {
    const report = document.createGlyph("newGlyph", "0042", 500);

    expect(report).toMatchObject({
      glyphId: "glyph_newGlyph",
      glyphName: "newGlyph",
      variableReadiness: "singleSource",
      missingLayerCount: 0,
    });
    expect(report.impact.canonicalPaths).toEqual(["glyphs/glyph_newGlyph.json"]);
  });

  it("renames component bases by stable glyph id", () => {
    const report = document.renameGlyph("glyph_A", "A.base");

    expect(report.impact.canonicalPaths).toEqual([
      "glyphs/glyph_A.json",
      "glyphs/glyph_Aacute.json",
    ]);
    expect(glyph("glyph_Aacute")).toMatchObject({
      componentBaseGlyphNames: ["A.base"],
    });
  });

  it("reports source readiness while filling sparse source layers", () => {
    const source = document.createSource("Bold", 900);
    expect(source).toMatchObject({
      sourceId: "source_Bold",
      sourceName: "Bold",
      variableReadiness: "missingSourceLayers",
    });

    const layer = document.createGlyphSourceLayer("glyph_A", source.sourceId, 700);
    expect(layer).toMatchObject({
      glyphId: "glyph_A",
      variableReadiness: "missingSourceLayers",
    });
    expect(layer.impact.canonicalPaths).toEqual(["glyphs/glyph_A.json"]);
  });

  it("blocks save when a canonical file changed outside the document", () => {
    document.renameGlyph("glyph_A", "A.base");
    writeFileSync(join(packagePath, "glyphs", "glyph_A.json"), '{"externally":"modified"}\n');

    expect(document.previewSave(packagePath)).toMatchObject({
      status: "blockedByExternalChanges",
      primaryAction: "resolveExternalChanges",
      conflictCount: 1,
      stagedRecoveryCount: 0,
    });
  });

  it("removes staged transactions after save", () => {
    document.renameGlyph("glyph_A", "A.base");

    expect(document.previewSave(packagePath)).toMatchObject({
      status: "ready",
      primaryAction: "save",
      conflictCount: 0,
    });
    expect(document.save(packagePath)).toMatchObject({
      status: "saved",
      stagedRecoveryCount: 0,
    });
    expect(existsSync(join(packagePath, "font.json"))).toBe(true);
    expect(existsSync(join(packagePath, "glyphs", "glyph_A.json"))).toBe(true);
  });
});
