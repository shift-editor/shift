import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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

  function fnv64Hex(bytes) {
    let hash = 0xcbf29ce484222325n;
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, "0");
  }

  function jsonBytes(value) {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  }

  function fingerprint(relativePath) {
    const bytes = readFileSync(join(packagePath, relativePath));
    return {
      exists: true,
      size: bytes.byteLength,
      hash: fnv64Hex(bytes),
    };
  }

  function writeStagedGlyphRename(newName) {
    const paths = ["glyphs/glyph_A.json", "glyphs/glyph_Aacute.json"];
    const glyphA = JSON.parse(readFileSync(join(packagePath, paths[0]), "utf8"));
    const glyphAacute = JSON.parse(readFileSync(join(packagePath, paths[1]), "utf8"));
    glyphA.name = newName;
    glyphAacute.layers.source_Regular.components[0].baseGlyphName = newName;

    const payloads = new Map([
      [paths[0], jsonBytes(glyphA)],
      [paths[1], jsonBytes(glyphAacute)],
    ]);
    const files = Object.fromEntries(paths.map((path) => [path, fingerprint(path)]));
    const prepared = {
      diff: {
        changes: [
          { kind: "renameGlyph", glyph_id: "glyph_A" },
          { kind: "updateGlyphLabels", glyph_id: "glyph_Aacute" },
        ],
        impact: {
          canonicalPaths: paths,
          removedCanonicalPaths: [],
          derivedPaths: [],
        },
      },
      impactedPaths: paths,
      expectedFingerprint: { files },
      currentFingerprint: { files },
      conflicts: [],
      operations: paths.map((path) => {
        const bytes = payloads.get(path);
        return {
          kind: "writeFile",
          path,
          purpose: "canonical",
          size: bytes.byteLength,
          hash: fnv64Hex(bytes),
        };
      }),
    };
    const marker = jsonBytes(prepared);
    const transactionId = fnv64Hex(marker);
    const transactionPath = join(packagePath, ".shift-txn", transactionId);
    const payloadRoot = join(transactionPath, "payloads");
    mkdirSync(payloadRoot, { recursive: true });
    for (const [path, bytes] of payloads) {
      const payloadPath = join(payloadRoot, path);
      mkdirSync(join(payloadPath, ".."), { recursive: true });
      writeFileSync(payloadPath, bytes);
    }
    writeFileSync(join(transactionPath, "commit.json"), marker);
    return { payloadRoot };
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

  it("recovers partially applied staged transactions before opening editable data", () => {
    const staged = writeStagedGlyphRename("RecoveredBase");
    copyFileSync(
      join(staged.payloadRoot, "glyphs", "glyph_A.json"),
      join(packagePath, "glyphs", "glyph_A.json"),
    );

    expect(document.previewOpen(packagePath)).toMatchObject({
      status: "recoveryRequired",
      primaryAction: "recoverThenLoad",
      stagedRecoveryCount: 1,
      resumeRecoveryCount: 1,
      appliedPathCount: 1,
      pendingPathCount: 1,
    });
    expect(() => {
      const reopened = new ShiftSourceDocument();
      reopened.open(packagePath);
    }).toThrow();

    expect(document.recoverAndOpen(packagePath)).toMatchObject({
      recoveredTransactionCount: 1,
      glyphCount: 2,
      sourceCount: 1,
    });
    expect(glyph("glyph_A")).toMatchObject({ name: "RecoveredBase" });
    expect(glyph("glyph_Aacute")).toMatchObject({
      componentBaseGlyphNames: ["RecoveredBase"],
    });
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

    expect(document.masterLayerWorklist()).toMatchObject({
      variableReadiness: "missingSourceLayers",
      sourceCount: 2,
      glyphCount: 2,
      sourceNeedingWorkCount: 1,
      missingLayerCount: 2,
      items: [
        {
          sourceId: "source_Bold",
          sourceName: "Bold",
          status: "missingLayers",
          missingLayerCount: 2,
          missingGlyphLayers: [
            {
              glyphId: "glyph_A",
              glyphName: "A",
              sourceId: "source_Bold",
            },
            {
              glyphId: "glyph_Aacute",
              glyphName: "Aacute",
              sourceId: "source_Bold",
            },
          ],
        },
      ],
    });

    const layer = document.createGlyphSourceLayer("glyph_A", source.sourceId, 700);
    expect(layer).toMatchObject({
      glyphId: "glyph_A",
      variableReadiness: "missingSourceLayers",
    });
    expect(layer.missingLayerCount).toBeGreaterThan(0);
    expect(document.masterLayerWorklist()).toMatchObject({
      missingLayerCount: 1,
      items: [
        {
          sourceId: "source_Bold",
          missingLayerCount: 1,
          missingGlyphLayers: [
            {
              glyphId: "glyph_Aacute",
              glyphName: "Aacute",
            },
          ],
        },
      ],
    });
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
