import { createBridge, type ShiftBridge } from "@shift/bridge";
import { mintGlyphId, type FontIntent, type GlyphName, type Unicode } from "@shift/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkspacePackageIdentity } from "../../shared/workspace/protocol";
import { DocumentStorage } from "./DocumentStorage";
import { PackageOpener } from "./PackageOpener";
import { PackageAddress } from "./types";

const createGlyph = (name: GlyphName, unicode: Unicode): FontIntent => ({
  kind: "createGlyph",
  createGlyph: {
    glyphId: mintGlyphId(),
    name,
    unicodes: [unicode],
  },
});

const createGlyphA = (): FontIntent => createGlyph("A" as GlyphName, 65 as Unicode);

describe("PackageOpener preserves package-backed document bindings", () => {
  let tmpRoot: string;
  let storage: DocumentStorage;
  let documentIndex = 0;
  let externalIndex = 0;
  let bridges: ShiftBridge[] = [];

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-package-opener-"));
    documentIndex = 0;
    externalIndex = 0;
    bridges = [];
    storage = new DocumentStorage(tmpRoot, () => `doc_${++documentIndex}`);
  });

  afterEach(() => {
    for (const bridge of bridges) {
      try {
        bridge.closeWorkspace();
      } catch {
        // The bridge may have only inspected package metadata.
      }
    }

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeBridge(): ShiftBridge {
    const bridge = createBridge();
    bridges.push(bridge);
    return bridge;
  }

  function inspectPackage(bridge: ShiftBridge, sourcePath: string): WorkspacePackageIdentity {
    const identity = bridge.inspectPackage(sourcePath);
    return {
      packageId: identity.packageId,
      canonicalPath: identity.canonicalPath,
      fingerprint: identity.fingerprint,
    };
  }

  function createPackageSource(name: string): {
    sourcePath: string;
    identity: WorkspacePackageIdentity;
  } {
    const bridge = makeBridge();
    const sourcePath = path.join(tmpRoot, name);
    const storePath = path.join(tmpRoot, "external", `${name}.sqlite`);

    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    bridge.createUntitledWorkspace(storePath);
    bridge.setDocumentId(`external_${++externalIndex}`);
    bridge.apply([createGlyphA()], "Add Glyph");
    bridge.saveWorkspaceAs(sourcePath);

    const identity = inspectPackage(bridge, sourcePath);
    bridge.closeWorkspace();
    return { sourcePath, identity };
  }

  function externallyAddGlyph(
    sourcePath: string,
    name: GlyphName,
    unicode: Unicode,
  ): WorkspacePackageIdentity {
    const bridge = makeBridge();
    const storePath = path.join(tmpRoot, "external", `${String(name)}.sqlite`);

    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    bridge.openWorkspace(sourcePath, storePath);
    bridge.setDocumentId(`external_${++externalIndex}`);
    bridge.apply([createGlyph(name, unicode)], "External Edit");
    bridge.saveWorkspace();

    const identity = inspectPackage(bridge, sourcePath);
    bridge.closeWorkspace();
    return identity;
  }

  function openPackage(
    bridge: ShiftBridge,
    identity: WorkspacePackageIdentity,
  ): ReturnType<PackageOpener["open"]> {
    return new PackageOpener(bridge, storage).open(identity);
  }

  function glyphNames(bridge: ShiftBridge): GlyphName[] {
    return bridge.getGlyphs().map((glyph) => glyph.name);
  }

  it("hydrates a package with no binding into a fresh document", () => {
    const { identity } = createPackageSource("Hydrate.shift");
    const bridge = makeBridge();

    const opened = openPackage(bridge, identity);

    expect(opened.document.documentId).toBe("doc_1");
    expect(opened.address).toMatchObject({
      packageId: identity.packageId,
      canonicalPath: identity.canonicalPath,
    });
    expect(storage.packageBinding(opened.address)?.documentId).toBe(opened.document.documentId);
    expect(glyphNames(bridge)).toEqual(["A"]);
  });

  it("resumes a dirty binding when the package fingerprint still matches", () => {
    const { identity } = createPackageSource("Resume.shift");
    const firstBridge = makeBridge();
    const firstOpen = openPackage(firstBridge, identity);
    firstBridge.apply([createGlyph("B" as GlyphName, 66 as Unicode)], "Add Glyph");
    firstBridge.closeWorkspace();
    const nextBridge = makeBridge();

    const reopened = openPackage(nextBridge, identity);

    expect(reopened.document.documentId).toBe(firstOpen.document.documentId);
    expect(glyphNames(nextBridge)).toEqual(["A", "B"]);
    expect(nextBridge.documentState()).toMatchObject({
      dirty: true,
      saveTarget: identity.canonicalPath,
    });
  });

  it("replaces a clean binding with a fresh document", () => {
    const { identity } = createPackageSource("Replace.shift");
    const firstBridge = makeBridge();
    const firstOpen = openPackage(firstBridge, identity);
    const oldDocumentPath = path.dirname(firstOpen.document.storePath);
    firstBridge.closeWorkspace();
    const nextBridge = makeBridge();

    const reopened = openPackage(nextBridge, identity);

    expect(reopened.document.documentId).not.toBe(firstOpen.document.documentId);
    expect(fs.existsSync(oldDocumentPath)).toBe(false);
    expect(glyphNames(nextBridge)).toEqual(["A"]);
    expect(storage.packageBinding(reopened.address)?.documentId).toBe(reopened.document.documentId);
  });

  it("orphans a dirty binding when the source package diverges", () => {
    const { sourcePath, identity } = createPackageSource("Diverged.shift");
    const firstBridge = makeBridge();
    const firstOpen = openPackage(firstBridge, identity);
    firstBridge.apply([createGlyph("B" as GlyphName, 66 as Unicode)], "Add Glyph");
    const oldDocumentPath = path.dirname(firstOpen.document.storePath);
    const divergedIdentity = externallyAddGlyph(sourcePath, "C" as GlyphName, 67 as Unicode);
    firstBridge.closeWorkspace();
    const nextBridge = makeBridge();

    const reopened = openPackage(nextBridge, divergedIdentity);

    expect(reopened.document.documentId).not.toBe(firstOpen.document.documentId);
    expect(glyphNames(nextBridge)).toEqual(["A", "C"]);
    expect(fs.existsSync(oldDocumentPath)).toBe(true);
    expect(
      fs.existsSync(path.join(tmpRoot, "orphaned", `${firstOpen.document.documentId}.json`)),
    ).toBe(true);
  });

  it("resumes and relinks a dirty binding for a moved package", () => {
    const { sourcePath, identity } = createPackageSource("Original.shift");
    const movedPath = path.join(tmpRoot, "Moved.shift");
    const oldAddress = PackageAddress.fromIdentity(identity);
    const firstBridge = makeBridge();
    const firstOpen = openPackage(firstBridge, identity);
    firstBridge.apply([createGlyph("B" as GlyphName, 66 as Unicode)], "Add Glyph");
    fs.renameSync(sourcePath, movedPath);
    firstBridge.closeWorkspace();
    const nextBridge = makeBridge();
    const movedIdentity = inspectPackage(nextBridge, movedPath);
    const movedAddress = PackageAddress.fromIdentity(movedIdentity);

    const reopened = openPackage(nextBridge, movedIdentity);

    expect(reopened.document.documentId).toBe(firstOpen.document.documentId);
    expect(glyphNames(nextBridge)).toEqual(["A", "B"]);
    expect(storage.packageBinding(oldAddress)).toBeNull();
    expect(storage.packageBinding(movedAddress)?.documentId).toBe(firstOpen.document.documentId);
  });
});
