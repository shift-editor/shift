import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const require = createRequire(import.meta.url);
const { Bridge, LayerReader } = require("../index.js");

let counter = 0;
const mintId = (prefix) => `${prefix}_reader${String(counter++).padStart(4, "0")}`;
const text = (bytes) => new TextDecoder().decode(bytes);

/** A names table as `pack::CarriedNames` writes it: each name's UTF-8 length as a little-endian u32, then its text. */
function namesBlob(names) {
  const parts = names.map((name) => new TextEncoder().encode(name));
  const blob = new Uint8Array(parts.reduce((total, part) => total + 4 + part.length, 0));
  const view = new DataView(blob.buffer);
  let at = 0;
  for (const part of parts) {
    view.setUint32(at, part.length, true);
    blob.set(part, at + 4);
    at += 4 + part.length;
  }
  return blob;
}

function readNames(blob) {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const names = [];
  for (let at = 0; at < blob.length; ) {
    const length = view.getUint32(at, true);
    names.push(new TextDecoder().decode(blob.subarray(at + 4, at + 4 + length)));
    at += 4 + length;
  }
  return names;
}

const METHODS = { layers: 0, basesOf: 1, compositesOf: 2 };

/**
 * Sends one StoreReader method with a list of ids, as shift-engine's
 * StoreReaderClient encodes it, and splits the reply into its numbers, its
 * blobs and the names it carries.
 */
function ask(reader, method, ids) {
  const numbers = new Float64Array([ids.length, ...ids.map((_, index) => index)]);
  const reply = reader.request(METHODS[method], numbers, [namesBlob(ids)]);
  return {
    numbers: [...reply.numbers],
    blobs: reply.blobs.slice(0, -1),
    names: readNames(reply.blobs.at(-1)),
  };
}

/** A reply's list of ids after its ok flag. */
function okIds(reply) {
  const [ok, count, ...ids] = reply.numbers;
  expect(ok).toBe(1);
  expect(ids).toHaveLength(count);
  return ids.map((id) => reply.names[id]);
}

describe("LayerReader", () => {
  let bridge;
  let tempDir;
  let storePath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shift-layer-reader-"));
    storePath = join(tempDir, "working.sqlite");
    bridge = new Bridge();
    bridge.createUntitledWorkspace(storePath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createGlyph(name) {
    const glyphId = mintId("glyph");
    const layerId = mintId("layer");
    bridge.apply([
      { kind: "createGlyph", createGlyph: { glyphId, name, unicodes: [] } },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId, glyphId, sourceId: bridge.getSources()[0].id },
      },
    ]);
    return { glyphId, layerId };
  }

  function addPoint(layerId, contourId, x) {
    const pointId = mintId("point");
    bridge.apply([
      {
        kind: "addPoints",
        addPoints: {
          layerId,
          contourId,
          points: [{ id: pointId, x, y: 0, pointType: "onCurve", smooth: false }],
        },
      },
    ]);
    return pointId;
  }

  it("answers a StoreReader request with layers as one blob", () => {
    const { layerId } = createGlyph("A");
    const contourId = mintId("contour");
    bridge.apply([{ kind: "addContour", addContour: { layerId, contourId, closed: false } }]);
    const point = addPoint(layerId, contourId, 10);

    const reader = LayerReader.openWorkingStore(storePath);
    const reply = ask(reader, "layers", [layerId]);

    expect(reply.numbers).toEqual([1, 0]);
    expect(reply.blobs).toHaveLength(1);
    // A MessagePack array of one named-field layer.
    expect(reply.blobs[0][0]).toBe(0x91);
    expect(text(reply.blobs[0])).toContain(layerId);
    expect(text(reply.blobs[0])).toContain(point);

    const second = addPoint(layerId, contourId, 20);
    expect(text(ask(reader, "layers", [layerId]).blobs[0])).toContain(second);
  });

  it("answers bases without the roots and only direct composites", () => {
    const base = createGlyph("base");
    const middle = createGlyph("middle");
    const top = createGlyph("top");
    const use = (composite, glyph) => ({
      kind: "addComponent",
      addComponent: {
        layerId: composite.layerId,
        componentId: mintId("component"),
        baseGlyphId: glyph.glyphId,
      },
    });
    bridge.apply([use(middle, base), use(top, middle)]);
    const reader = LayerReader.openWorkingStore(storePath);

    expect(okIds(ask(reader, "basesOf", [top.glyphId])).sort()).toEqual(
      [base.glyphId, middle.glyphId].sort(),
    );
    expect(okIds(ask(reader, "compositesOf", [base.glyphId]))).toEqual([middle.glyphId]);
  });

  it("replies with the closed error once the reader is closed", () => {
    const reader = LayerReader.openWorkingStore(storePath);
    reader.close();

    expect(ask(reader, "basesOf", []).numbers).toEqual([0, 0]);
  });

  it("replies with the store's error for a layer it does not hold", () => {
    const reply = ask(LayerReader.openWorkingStore(storePath), "layers", ["not a layer"]);

    const [ok, kind, detail] = reply.numbers;
    expect([ok, kind]).toEqual([0, 1]);
    expect(reply.names[detail]).toMatch(/not a layer/);
  });
});
