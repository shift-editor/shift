import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { render } from "./generate.mjs";
import { Reader, syncTransport, Writer, type Names } from "./index";

const SEGMENT_KIND = {
  kind: "enum",
  rust: "SegmentKind",
  name: "SegmentKind",
  doc: null,
  variants: ["line", "quad"],
};
const ANCHOR = {
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
const MEASURE = {
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

const folder = mkdtempSync(join(import.meta.dirname, ".generated-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

interface Measure {
  width(anchor: unknown): number;
  scaled(anchor: unknown, factor: number): unknown;
  counts(): unknown;
}

/** Renders `fragments` and imports the module, resolving `@shift/pack` to this package's source. */
async function load(fragments: Record<string, unknown>[]): Promise<Record<string, unknown>> {
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

/** A module that records each request and answers with `reply`'s numbers. */
function module(reply: (write: Writer) => void) {
  const requests: { method: number; input: number[] }[] = [];
  const transport = syncTransport((method, input) => {
    requests.push({ method, input: [...input] });
    const write = new Writer(names);
    reply(write);
    return write.finish().slice();
  }, names);
  return { requests, transport };
}

describe("a generated interface class", () => {
  it("sends a method by its index with its arguments in declaration order", async () => {
    const generated = await load([SEGMENT_KIND, ANCHOR, MEASURE]);
    const { requests, transport } = module((write) => write.number(7));
    const measure = new (generated.Measure as new (t: unknown) => Measure)(transport);

    const width = measure.width({ name: null, x: 3, kinds: ["quad", "line"] });

    expect(width).toBe(7);
    expect(requests).toEqual([{ method: 0, input: [0, 3, 2, 1, 0] }]);
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
    expect(requests[0]).toEqual({ method: 1, input: [0, 3, 0, 2] });
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

describe("render", () => {
  it("fails for a type no fragment declares", () => {
    expect(() => render([ANCHOR, MEASURE])).toThrow(
      "Anchor uses SegmentKind, which has no #[derive(Pack)]",
    );
  });

  it("fails when two crates declare different types under one name", () => {
    const other = { ...SEGMENT_KIND, variants: ["cubic"], crate: "other" };

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
