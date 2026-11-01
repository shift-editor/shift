import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { engineOpen, engineReads, engineRelease, initEngine } from "@shift/wasm/engine";
import { storeReader } from "@shift/wasm/store-reader";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { join } from "path";

const require = createRequire(import.meta.url);
const { SourceReader } = require("../index.js");

const FONTS = join(fileURLToPath(import.meta.url), "../../../../fixtures/fonts");
const UFO = join(FONTS, "mutatorsans/MutatorSansLightCondensed.ufo");

await initEngine();

const text = (bytes) => new TextDecoder().decode(bytes);
const byId = (left, right) => (left < right ? -1 : 1);

/** The error a store reader's reply carried, as the engine's client throws it. */
function replyError(read) {
  try {
    read();
  } catch (error) {
    return error.error;
  }
  throw new Error("the read did not fail");
}

describe("SourceReader answers the engine's store requests from a UFO", () => {
  let reader;
  let store;
  let engine;
  let records;

  beforeEach(() => {
    reader = SourceReader.open(UFO);
    store = storeReader((method, numbers, blobs) => reader.request(method, numbers, [...blobs]));
    engine = engineOpen(reader.directory(), (method, numbers, blobs) =>
      reader.request(method, numbers, [...blobs]),
    );
    records = new Map(
      engineReads(engine)
        .glyphRecords()
        .map((record) => [record.name, record]),
    );
  });

  afterEach(() => {
    engineRelease(engine);
    reader.close();
  });

  it("opens an engine whose records list the file's components", () => {
    const aacute = records.get("Aacute");

    expect(aacute.componentBaseGlyphIds).toEqual(
      [records.get("A").id, records.get("acute").id].toSorted(byId),
    );
    expect(records.get("acute").componentBaseGlyphIds).toEqual([]);
  });

  it("reads a glyph's layer as one named-field MessagePack array", () => {
    const [layer] = records.get("Aacute").layers;

    const bytes = store.layers([layer.id]);

    expect(bytes[0]).toBe(0x91);
    expect(text(bytes)).toContain(layer.id);
    expect(text(bytes)).toContain("acute");
  });

  it("answers bases transitively without the roots, and direct composites", () => {
    const [A, acute, Aacute] = ["A", "acute", "Aacute"].map((name) => records.get(name).id);

    expect(store.basesOf([Aacute]).toSorted(byId)).toEqual([A, acute].toSorted(byId));
    expect(store.basesOf([A])).toEqual([]);
    expect(store.compositesOf([acute])).toContain(Aacute);
    expect(store.componentBases([Aacute, acute])).toEqual([[A, acute].toSorted(byId), []]);
  });

  it("answers an empty scene", () => {
    expect([...store.sceneNodes()]).toEqual([0x90]);
  });

  it("rejects a layer the file does not hold and lists nothing for an unknown glyph", () => {
    expect(replyError(() => store.layers(["layer_unknown"]))).toMatchObject({
      kind: "unreadable",
      detail: expect.stringMatching(/layer_unknown/),
    });
    expect(store.componentBases(["glyph_unknown"])).toEqual([[]]);
    expect(store.attachingAnchorLayers(["layer_unknown"])).toEqual([]);
  });

  it("replies with the closed error once the reader is closed", () => {
    reader.close();

    expect(replyError(() => store.basesOf([]))).toMatchObject({ kind: "closed" });
    expect(() => reader.directory()).toThrow(/closed/);
  });
});

describe("SourceReader.open", () => {
  it("refuses a compiled font, which has no authored glyphs", () => {
    expect(() => SourceReader.open(join(FONTS, "mutatorsans/MutatorSans.ttf"))).toThrow(
      /glyph by glyph/,
    );
  });
});
