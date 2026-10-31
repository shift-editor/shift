import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { render, type Fragment } from "./generate";
import {
  carryingNames,
  PackError,
  Reader,
  syncTransport,
  Writer,
  type Blobs,
  type Names,
} from "./index";

const SEGMENT_KIND: Fragment = {
  kind: "enum",
  rust: "SegmentKind",
  name: "SegmentKind",
  doc: null,
  variants: ["line", "quad"],
};
const ANCHOR: Fragment = {
  kind: "struct",
  rust: "Anchor",
  name: "Anchor",
  doc: "An anchor.",
  fields: [
    { name: "name", doc: null, type: { kind: "option", inner: { kind: "name" } } },
    { name: "x", doc: null, type: { kind: "number" } },
    {
      name: "kinds",
      doc: null,
      type: { kind: "list", item: { kind: "ref", rust: "SegmentKind" } },
    },
  ],
};
const MEASURE: Fragment = {
  kind: "interface",
  rust: "Measure",
  name: "Measure",
  doc: null,
  methods: [
    {
      name: "width",
      doc: null,
      params: [{ name: "anchor", type: { kind: "ref", rust: "Anchor" } }],
      output: { kind: "number" },
    },
    {
      name: "scaled",
      doc: null,
      params: [
        { name: "anchor", type: { kind: "ref", rust: "Anchor" } },
        { name: "factor", type: { kind: "number" } },
      ],
      output: { kind: "ref", rust: "Anchor" },
    },
    {
      name: "counts",
      doc: null,
      params: [],
      output: {
        kind: "option",
        inner: { kind: "list", item: { kind: "list", item: { kind: "count" } } },
      },
    },
  ],
};

const EDIT: Fragment = {
  kind: "union",
  rust: "Edit",
  name: "Edit",
  doc: null,
  cases: [
    {
      name: "move",
      doc: null,
      fields: [
        { name: "x", doc: null, type: { kind: "number" } },
        { name: "y", doc: null, type: { kind: "number" } },
      ],
    },
    {
      name: "rename",
      doc: null,
      fields: [{ name: "glyph", doc: null, type: { kind: "ref", rust: "GlyphId" } }],
    },
    { name: "undo", doc: null, fields: [] },
  ],
};
const GLYPH_ID: Fragment = {
  kind: "id",
  rust: "GlyphId",
  name: "GlyphId",
  doc: null,
  module: "@shift/types",
};
const EDITS: Fragment = {
  kind: "interface",
  rust: "Edits",
  name: "Edits",
  doc: null,
  methods: [
    {
      name: "apply",
      doc: null,
      params: [
        { name: "edits", type: { kind: "list", item: { kind: "ref", rust: "Edit" } } },
        { name: "values", type: { kind: "numbers" } },
      ],
      output: { kind: "list", item: { kind: "ref", rust: "Edit" } },
    },
  ],
};

interface Edits {
  apply(edits: unknown[], values: Float64Array): unknown;
}

const folder = mkdtempSync(join(import.meta.dirname, ".generated-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

interface Measure {
  width(anchor: unknown): number;
  scaled(anchor: unknown, factor: number): unknown;
  counts(): unknown;
}

/** Renders `fragments` and imports the module, resolving `@shift/pack` to this package's source. */
async function load(fragments: Fragment[]): Promise<Record<string, unknown>> {
  const file = join(folder, `module${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(file, render(fragments).replace('from "@shift/pack"', 'from "../index"'));
  return import(file);
}

const names: Names = {
  ids: new Map<string, number>(),
  id(name: string) {
    const ids = (this as unknown as { ids: Map<string, number> }).ids;
    if (!ids.has(name)) ids.set(name, ids.size);
    return ids.get(name)!;
  },
  name(id: number) {
    const ids = (this as unknown as { ids: Map<string, number> }).ids;
    return [...ids].find(([, value]) => value === id)?.[0] ?? "";
  },
} as Names;

/** A module that records each request and answers with what `reply` writes, its blobs taken on demand. */
function module(reply: (write: Writer) => void) {
  const requests: { method: number; input: number[]; blobs: Blobs | undefined }[] = [];
  let replyBlobs: Blobs = [];
  let blobsTaken = 0;
  const transport = syncTransport(
    (method, input, blobs) => {
      requests.push({ method, input: [...input], blobs });
      const write = new Writer(names);
      reply(write);
      replyBlobs = [...write.blobs()];
      return write.finish().slice();
    },
    names,
    () => {
      blobsTaken++;
      return replyBlobs;
    },
  );
  return { requests, transport, blobsTaken: () => blobsTaken };
}

const READ_ERROR: Fragment = {
  kind: "union",
  rust: "ReadError",
  name: "ReadError",
  doc: null,
  cases: [
    { name: "closed", doc: null, fields: [] },
    {
      name: "missing",
      doc: null,
      fields: [{ name: "glyph", doc: null, type: { kind: "ref", rust: "GlyphId" } }],
    },
  ],
};
const STORE: Fragment = {
  kind: "interface",
  rust: "Store",
  name: "Store",
  doc: "A store.",
  methods: [
    {
      name: "layers",
      doc: "Layers, as bytes.",
      params: [{ name: "glyphs", type: { kind: "list", item: { kind: "ref", rust: "GlyphId" } } }],
      output: {
        kind: "result",
        ok: { kind: "bytes" },
        err: { kind: "ref", rust: "ReadError" },
      },
    },
    {
      name: "save",
      doc: null,
      params: [
        { name: "first", type: { kind: "bytes" } },
        { name: "second", type: { kind: "bytes" } },
      ],
      output: { kind: "count" },
    },
    {
      name: "basesOf",
      doc: null,
      params: [{ name: "glyphs", type: { kind: "list", item: { kind: "ref", rust: "GlyphId" } } }],
      output: {
        kind: "result",
        ok: { kind: "list", item: { kind: "ref", rust: "GlyphId" } },
        err: { kind: "ref", rust: "ReadError" },
      },
    },
  ],
};

interface Store {
  layers(glyphs: string[]): Uint8Array;
  save(first: Uint8Array, second: Uint8Array): number;
  basesOf(glyphs: string[]): string[];
}

/** A names table as Rust's `pack::CarriedNames` writes it. */
function namesBlob(names: readonly string[]): Uint8Array {
  const texts = names.map((name) => new TextEncoder().encode(name));
  const blob = new Uint8Array(texts.reduce((total, text) => total + 4 + text.length, 0));
  const view = new DataView(blob.buffer);
  let at = 0;
  for (const text of texts) {
    view.setUint32(at, text.length, true);
    blob.set(text, at + 4);
    at += 4 + text.length;
  }
  return blob;
}

describe("a generated interface class", () => {
  it("sends a method by its index with its arguments in declaration order", async () => {
    const generated = await load([SEGMENT_KIND, ANCHOR, MEASURE]);
    const { requests, transport } = module((write) => write.number(7));
    const measure = new (generated.Measure as new (t: unknown) => Measure)(transport);

    const width = measure.width({ name: null, x: 3, kinds: ["quad", "line"] });

    expect(width).toBe(7);
    expect(requests).toEqual([{ method: 0, input: [0, 3, 2, 1, 0], blobs: undefined }]);
  });

  it("reads a struct result with its names, options and enums", async () => {
    const generated = await load([SEGMENT_KIND, ANCHOR, MEASURE]);
    const { requests, transport } = module((write) => {
      write.flag(true);
      write.name("top");
      write.number(6);
      write.count(1);
      write.count(1);
    });
    const measure = new (generated.Measure as new (t: unknown) => Measure)(transport);

    const scaled = measure.scaled({ x: 3, kinds: [] }, 2);

    expect(scaled).toEqual({ name: "top", x: 6, kinds: ["quad"] });
    expect(requests[0]).toEqual({ method: 1, input: [0, 3, 0, 2], blobs: undefined });
  });

  it("reads nested lists inside an option", async () => {
    const generated = await load([SEGMENT_KIND, ANCHOR, MEASURE]);
    const { transport } = module((write) => {
      for (const value of [1, 2, 2, 5, 6, 0]) write.number(value);
    });
    const measure = new (generated.Measure as new (t: unknown) => Measure)(transport);

    expect(measure.counts()).toEqual([[5, 6], []]);
  });

  it("throws on an enum index the module does not know", async () => {
    const generated = await load([SEGMENT_KIND, ANCHOR, MEASURE]);
    const { transport } = module((write) => {
      for (const value of [0, 1, 1, 9]) write.number(value);
    });
    const measure = new (generated.Measure as new (t: unknown) => Measure)(transport);

    expect(() => measure.scaled({ x: 0, kinds: [] }, 1)).toThrow("unknown SegmentKind");
  });
});

describe("a generated union", () => {
  it("writes each case as its index, then its fields, and ids as interned names", async () => {
    const generated = await load([EDIT, GLYPH_ID, EDITS]);
    const { requests, transport } = module((write) => write.count(0));
    const edits = new (generated.Edits as new (t: unknown) => Edits)(transport);

    edits.apply(
      [{ kind: "move", x: 1, y: 2 }, { kind: "rename", glyph: "glyph_a" }, { kind: "undo" }],
      new Float64Array([7, 8]),
    );

    const glyph = names.id("glyph_a");
    expect(requests[0]!.input).toEqual([3, 0, 1, 2, 1, glyph, 2, 2, 7, 8]);
  });

  it("reads each case back tagged by kind", async () => {
    const generated = await load([EDIT, GLYPH_ID, EDITS]);
    const glyph = names.id("glyph_b");
    const { transport } = module((write) => {
      for (const value of [3, 2, 1, glyph, 0, 5, 6]) write.number(value);
    });
    const edits = new (generated.Edits as new (t: unknown) => Edits)(transport);

    expect(edits.apply([], new Float64Array())).toEqual([
      { kind: "undo" },
      { kind: "rename", glyph: "glyph_b" },
      { kind: "move", x: 5, y: 6 },
    ]);
  });

  it("refuses to write a case it does not know, rather than send nothing for it", async () => {
    const generated = await load([EDIT, GLYPH_ID, EDITS]);
    const { requests, transport } = module((write) => write.count(0));
    const edits = new (generated.Edits as new (t: unknown) => Edits)(transport);

    expect(() => edits.apply([{ kind: "explode" }], new Float64Array())).toThrow(
      "unknown Edit kind explode",
    );
    expect(requests).toEqual([]);
  });

  it("throws on a case index the module does not know", async () => {
    const generated = await load([EDIT, GLYPH_ID, EDITS]);
    const { transport } = module((write) => {
      write.count(1);
      write.count(9);
    });
    const edits = new (generated.Edits as new (t: unknown) => Edits)(transport);

    expect(() => edits.apply([], new Float64Array())).toThrow("unknown Edit");
  });
});

describe("bytes", () => {
  it("cross as an index into the request's blob list, without a copy", async () => {
    const generated = await load([READ_ERROR, GLYPH_ID, STORE]);
    const { requests, transport } = module((write) => write.count(2));
    const store = new (generated.Store as new (t: unknown) => Store)(transport);
    const first = new Uint8Array([1, 2]);
    const second = new Uint8Array([3]);

    expect(store.save(first, second)).toBe(2);

    expect(requests[0]!.input).toEqual([0, 1]);
    expect(requests[0]!.blobs?.[0]).toBe(first);
    expect(requests[0]!.blobs?.[1]).toBe(second);
  });

  it("read back as the reply blob their index names", async () => {
    const generated = await load([READ_ERROR, GLYPH_ID, STORE]);
    const layers = new Uint8Array([9, 8, 7]);
    const { transport } = module((write) => {
      write.flag(true);
      write.bytes(layers);
    });
    const store = new (generated.Store as new (t: unknown) => Store)(transport);

    expect(store.layers(["glyph_a"])).toBe(layers);
  });

  it("are left out of a request without them and never taken for a reply without them", async () => {
    const generated = await load([SEGMENT_KIND, ANCHOR, MEASURE]);
    const { requests, transport, blobsTaken } = module((write) => write.number(1));
    const measure = new (generated.Measure as new (t: unknown) => Measure)(transport);

    measure.width({ name: null, x: 0, kinds: [] });
    measure.width({ name: null, x: 0, kinds: [] });

    expect(requests.map((request) => request.blobs)).toEqual([undefined, undefined]);
    expect(blobsTaken()).toBe(0);
  });
});

describe("a method returning a Result", () => {
  it("throws a PackError carrying the error and its kind", async () => {
    const generated = await load([READ_ERROR, GLYPH_ID, STORE]);
    const glyph = names.id("glyph_missing");
    const { transport } = module((write) => {
      write.flag(false);
      write.count(1);
      write.number(glyph);
    });
    const store = new (generated.Store as new (t: unknown) => Store)(transport);

    let thrown: unknown;
    try {
      store.layers(["glyph_missing"]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PackError);
    const error = thrown as PackError;
    expect(error.type).toBe("ReadError");
    expect(error.kind).toBe("missing");
    expect(error.error).toEqual({ kind: "missing", glyph: "glyph_missing" });
  });

  it("throws for an empty reply, as Rust reads one", async () => {
    const generated = await load([READ_ERROR, GLYPH_ID, STORE]);
    const { transport } = module(() => {});
    const store = new (generated.Store as new (t: unknown) => Store)(transport);

    expect(() => store.layers([])).toThrow("ReadError.closed");
  });

  it("is refused anywhere but as a method's result", () => {
    const nested: Fragment = {
      ...ANCHOR,
      fields: [
        {
          name: "outcome",
          doc: null,
          type: { kind: "result", ok: { kind: "number" }, err: { kind: "number" } },
        },
      ],
    };

    expect(() => render([nested, MEASURE])).toThrow("a Result crosses only as");
  });
});

const FAILURE: Fragment = {
  kind: "union",
  rust: "Failure",
  name: "Failure",
  doc: null,
  cases: [
    {
      name: "unreadable",
      doc: null,
      fields: [{ name: "detail", doc: null, type: { kind: "name" } }],
    },
  ],
};
const LOCATIONS: Fragment = {
  kind: "interface",
  rust: "Locations",
  name: "Locations",
  doc: null,
  methods: [
    {
      name: "moveTo",
      doc: null,
      params: [
        {
          name: "location",
          type: { kind: "map", key: { kind: "ref", rust: "GlyphId" }, value: { kind: "number" } },
        },
      ],
      output: { kind: "unit" },
    },
    {
      name: "location",
      doc: null,
      params: [],
      output: { kind: "map", key: { kind: "name" }, value: { kind: "number" } },
    },
    {
      name: "close",
      doc: null,
      params: [],
      output: { kind: "result", ok: { kind: "unit" }, err: { kind: "ref", rust: "Failure" } },
    },
  ],
};

const LABELLED: Fragment = {
  kind: "interface",
  rust: "Labelled",
  name: "Labelled",
  doc: null,
  methods: [
    {
      name: "label",
      doc: null,
      params: [
        { name: "x", type: { kind: "number" } },
        { name: "name", type: { kind: "option", inner: { kind: "name" } } },
      ],
      output: { kind: "number" },
    },
  ],
};

interface Labelled {
  label(x: number, name?: string): number;
}

interface Locations {
  moveTo(location: Record<string, number>): unknown;
  location(): unknown;
  close(): unknown;
}

describe("a method without a result", () => {
  it("sends its arguments and reads nothing back", async () => {
    const generated = await load([GLYPH_ID, FAILURE, LOCATIONS]);
    const { requests, transport } = module(() => {});
    const locations = new (generated.Locations as new (t: unknown) => Locations)(transport);

    expect(locations.moveTo({})).toBeUndefined();
    expect(requests[0]).toEqual({ method: 0, input: [0], blobs: undefined });
  });

  it("returns nothing for an Ok without a value, and throws for an Err", async () => {
    const generated = await load([GLYPH_ID, FAILURE, LOCATIONS]);
    let ok = true;
    const { transport } = module((write) => {
      write.flag(ok);
      if (!ok) {
        write.count(0);
        write.name("store is gone");
      }
    });
    const locations = new (generated.Locations as new (t: unknown) => Locations)(transport);

    expect(locations.close()).toBeUndefined();
    ok = false;
    expect(() => locations.close()).toThrow("Failure.unreadable: store is gone");
  });
});

describe("a map", () => {
  it("writes its length, then each key and its value", async () => {
    const generated = await load([GLYPH_ID, FAILURE, LOCATIONS]);
    const { requests, transport } = module(() => {});
    const locations = new (generated.Locations as new (t: unknown) => Locations)(transport);

    locations.moveTo({ glyph_wght: 400 });

    expect(requests[0]!.input).toEqual([1, names.id("glyph_wght"), 400]);
  });

  it("reads back as a record", async () => {
    const generated = await load([GLYPH_ID, FAILURE, LOCATIONS]);
    const wdth = names.id("wdth");
    const { transport } = module((write) => {
      for (const value of [1, wdth, 75]) write.number(value);
    });
    const locations = new (generated.Locations as new (t: unknown) => Locations)(transport);

    expect(locations.location()).toEqual({ wdth: 75 });
  });
});

describe("a trailing optional argument", () => {
  it("may be left out, and writes as absent", async () => {
    const generated = await load([SEGMENT_KIND, ANCHOR, LABELLED]);
    const { requests, transport } = module((write) => write.number(1));
    const labelled = new (generated.Labelled as new (t: unknown) => Labelled)(transport);

    labelled.label(2);
    labelled.label(2, "top");

    expect(requests.map((request) => request.input)).toEqual([
      [2, 0],
      [2, 1, names.id("top")],
    ]);
    expect(render([SEGMENT_KIND, ANCHOR, LABELLED])).toContain(
      "label(x: number, name?: string | null): number",
    );
  });
});

describe("crates", () => {
  it("renders only the interfaces the listed packages declare", () => {
    const text = render(
      [{ ...MEASURE, crate: "one" }, { ...LABELLED, crate: "other" }, SEGMENT_KIND, ANCHOR],
      "",
      { crates: ["other"] },
    );

    expect(text).toContain("export class Labelled");
    expect(text).not.toContain("export class Measure");
  });
});

describe("brandModules", () => {
  it("imports an id's brand from the module it names instead", () => {
    const text = render([EDIT, GLYPH_ID, EDITS], "", {
      brandModules: { "@shift/types": "../ids" },
    });

    expect(text).toContain('import type { GlyphId } from "../ids"');
    expect(text).not.toContain('from "@shift/types"');
  });
});

describe("carryingNames", () => {
  it("sends the request's names as its last blob and reads the reply's from its own", async () => {
    const generated = await load([READ_ERROR, GLYPH_ID, STORE]);
    const requests: { numbers: number[]; blobs: Blobs }[] = [];
    const transport = carryingNames((_method, numbers, blobs) => {
      requests.push({ numbers: [...numbers], blobs });
      return {
        numbers: new Float64Array([1, 2, 1, 0]),
        blobs: [namesBlob(["glyph_base", "glyph_mark"])],
      };
    });
    const store = new (generated.Store as new (t: unknown) => Store)(transport);

    expect(store.basesOf(["glyph_a", "glyph_b", "glyph_a"])).toEqual(["glyph_mark", "glyph_base"]);
    expect(requests[0]!.numbers).toEqual([3, 0, 1, 0]);
    expect(requests[0]!.blobs).toEqual([namesBlob(["glyph_a", "glyph_b"])]);
  });

  it("starts each request's names afresh and keeps its bytes before the names", async () => {
    const generated = await load([READ_ERROR, GLYPH_ID, STORE]);
    const requests: Blobs[] = [];
    const layers = new Uint8Array([4, 5]);
    const transport = carryingNames((_method, _numbers, blobs) => {
      requests.push(blobs);
      return { numbers: new Float64Array([1, 0]), blobs: [layers, namesBlob([])] };
    });
    const store = new (generated.Store as new (t: unknown) => Store)(transport);

    store.layers(["glyph_a"]);
    expect(store.layers(["glyph_b"])).toBe(layers);
    expect(requests[1]).toEqual([namesBlob(["glyph_b"])]);
  });
});

describe("PackError", () => {
  it("takes a unit-only error's value as its kind", () => {
    expect(new PackError("Closed", "closed").kind).toBe("closed");
  });

  it("ends its message with the error's detail when it carries one", () => {
    const error = new PackError("ReadError", { kind: "unreadable", detail: "disk full" });

    expect(error.message).toBe("ReadError.unreadable: disk full");
    expect(new PackError("ReadError", { kind: "closed" }).message).toBe("ReadError.closed");
  });
});

describe("Reader.numbers", () => {
  it("reads a count of numbers as one view", () => {
    const read = new Reader(new Float64Array([2, 1.5, -2, 9]), names);

    expect([...read.numbers()]).toEqual([1.5, -2]);
    expect(read.number()).toBe(9);
  });
});

describe("render", () => {
  it("spells each type out by name, its schema beside it", () => {
    const text = render([SEGMENT_KIND, ANCHOR, MEASURE, EDIT, GLYPH_ID, EDITS]);

    expect(text).toContain("export interface Anchor {");
    expect(text).toContain("readonly name?: string | null;");
    expect(text).toContain("readonly kinds: readonly SegmentKind[];");
    expect(text).toMatch(/export type SegmentKind =\s*"line" \| "quad";/);
    expect(text).toMatch(/readonly kind: "rename";\s*readonly glyph: GlyphId;/);
    expect(text).toContain("export const AnchorSchema =");
  });

  it("fails for a type no fragment declares", () => {
    expect(() => render([ANCHOR, MEASURE])).toThrow(
      "Anchor uses SegmentKind, which has no #[derive(Pack)]",
    );
  });

  it("keeps one declaration when two crates declare the same shape under one name", () => {
    const documented = { ...SEGMENT_KIND, doc: "Kinds of segment.", crate: "other" };

    const text = render([{ ...SEGMENT_KIND, crate: "one" }, documented, ANCHOR, MEASURE]);

    expect(text.match(/export type SegmentKind =/g)).toHaveLength(1);
  });

  it("fails when two crates declare different types under one name", () => {
    const other: Fragment = { ...SEGMENT_KIND, kind: "enum", variants: ["cubic"], crate: "other" };

    expect(() => render([{ ...SEGMENT_KIND, crate: "one" }, other, ANCHOR, MEASURE])).toThrow(
      "two types are named SegmentKind (in one and other)",
    );
  });
});

describe("Reader", () => {
  it("reads past the end as zeros, as Rust's reader does", () => {
    const read = new Reader(new Float64Array([2]), names);

    expect([read.count(), read.number(), read.flag()]).toEqual([2, 0, false]);
  });
});
