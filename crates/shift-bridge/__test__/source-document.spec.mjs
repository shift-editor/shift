import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
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

  it("creates glyphs that can be selected by stable id", () => {
    const report = document.createGlyph("newGlyph", "0042", 500);

    expect(report).toMatchObject({
      glyphId: "glyph_newGlyph",
      glyphName: "newGlyph",
      variableReadiness: "singleSource",
      missingLayerCount: 0,
    });
    expect(glyph("glyph_newGlyph")).toMatchObject({
      id: "glyph_newGlyph",
      name: "newGlyph",
    });
  });

  it("renames component bases by stable glyph id", () => {
    const report = document.renameGlyph("glyph_A", "A.base");

    expect(report).toMatchObject({ glyphId: "glyph_A", glyphName: "A.base" });
    expect(glyph("glyph_Aacute")).toMatchObject({
      componentBaseGlyphNames: ["A.base"],
    });
  });

  it("tracks which glyphs still need a layer after adding a master", () => {
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
    expect(layer.missingLayerCount).toBeGreaterThan(0);
  });

  it("removes a base glyph by applying the component-use strategy", () => {
    expect(document.previewGlyphRemoval("glyph_A")).toMatchObject({
      glyphId: "glyph_A",
      glyphName: "A",
      canRemoveDirectly: false,
      requiresStrategy: true,
      componentUseCount: 1,
      componentUserCount: 1,
      validStrategies: ["removeComponentUses"],
      componentUsers: [
        {
          glyphId: "glyph_Aacute",
          glyphName: "Aacute",
          componentCount: 1,
        },
      ],
    });

    const edit = document.removeGlyphAndComponentUses("glyph_A");

    expect(edit).toMatchObject({
      glyphId: "glyph_A",
      glyphName: "A",
      removedComponentUseCount: 1,
      variableReadiness: "singleSource",
      componentUsers: [
        {
          glyphId: "glyph_Aacute",
          glyphName: "Aacute",
          componentCount: 1,
        },
      ],
    });
    expect(edit.impact.changeCount).toBe(2);
    expect(glyph("glyph_A")).toBeUndefined();
    expect(glyph("glyph_Aacute")).toMatchObject({
      componentBaseGlyphNames: [],
    });
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

    const reopened = new ShiftSourceDocument();
    reopened.open(packagePath);
    expect(reopened.glyphs().find((record) => record.id === "glyph_A")).toMatchObject({
      name: "A.base",
    });
  });
});
