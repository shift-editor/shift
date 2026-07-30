import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeLayer, GlyphCodecError, packLayer } from "./layer";
import type { GlyphCodecErrorCode, GlyphLayer } from "./types";

function fullLayer(): GlyphLayer {
  return {
    id: "layer_A_regular",
    sourceId: "source_regular",
    width: 600.125,
    height: 720.5,
    contours: [
      {
        id: "contour_outer",
        closed: true,
        points: [
          { id: "point_0", type: "on-curve", smooth: false, x: 100.25, y: -0 },
          { id: "point_1", type: "off-curve", smooth: true, x: 300.5, y: 700.75 },
          { id: "point_2", type: "qcurve", smooth: false, x: 500.875, y: 0 },
        ],
      },
      { id: "contour_open", closed: false, points: [] },
    ],
    components: [
      {
        id: "component_acute",
        baseGlyphId: "glyph_acute",
        baseGlyphName: "acutecomb",
        transform: {
          translateX: 10,
          translateY: 20,
          rotation: 5.5,
          scaleX: 1.25,
          scaleY: 0.75,
          skewX: 2,
          skewY: -1.5,
          centerX: 50,
          centerY: 75,
        },
      },
    ],
    anchors: [
      { id: "anchor_top", name: "top", x: 300, y: 700 },
      { id: "anchor_unnamed", name: null, x: 12.5, y: -30.25 },
    ],
    guidelines: [
      {
        id: "guideline_baseline",
        x: null,
        y: 0,
        angle: null,
        name: "Baseline",
        color: "0,0,1,1",
      },
      {
        id: "guideline_angle",
        x: 100,
        y: 200,
        angle: 45,
        name: null,
        color: null,
      },
    ],
    lib: new Map([
      [
        "array",
        {
          kind: "array" as const,
          value: [
            { kind: "boolean" as const, value: false },
            { kind: "boolean" as const, value: true },
          ],
        },
      ],
      ["data", { kind: "data" as const, value: Uint8Array.from([0, 1, 2, 255]) }],
      ["date", { kind: "date" as const, value: "2026-07-25T12:34:56Z" }],
      [
        "dict",
        {
          kind: "dict" as const,
          value: new Map([
            ["alpha", { kind: "string" as const, value: "value" }],
            ["omega", { kind: "uid" as const, value: 0xffff_ffff_ffff_ffffn }],
          ]),
        },
      ],
      ["float", { kind: "float" as const, value: -12.25 }],
      ["integer", { kind: "integer" as const, value: -0x8000_0000_0000_0000n }],
      ["string", { kind: "string" as const, value: "layer metadata" }],
      ["unsigned", { kind: "unsigned-integer" as const, value: 0xffff_ffff_ffff_ffffn }],
    ]),
  };
}

function emptyLayer(): GlyphLayer {
  return {
    id: "layer_empty",
    sourceId: "source_regular",
    width: 0,
    height: null,
    contours: [],
    components: [],
    anchors: [],
    guidelines: [],
    lib: new Map(),
  };
}

function fixture(file: string): Uint8Array {
  return readFileSync(new URL(`../../../fixtures/glyph-codec/layer-v1/${file}`, import.meta.url));
}

function errorCode(action: () => unknown): GlyphCodecErrorCode | null {
  try {
    action();
    return null;
  } catch (error) {
    if (!(error instanceof GlyphCodecError)) throw error;
    return error.code;
  }
}

function stringSectionEnd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return 72 + (view.getUint32(12, true) + 1) * 4 + view.getUint32(16, true);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

describe("shift.glyph-layer.v1", () => {
  it("shares byte-for-byte golden vectors with Rust", () => {
    const expected = fullLayer();
    const full = fixture("full.bin");
    expect(decodeLayer(full).unpack()).toEqual(expected);
    expect([...packLayer(expected).toUint8Array()]).toEqual([...full]);

    const empty = fixture("empty.bin");
    expect(decodeLayer(empty).unpack()).toEqual(emptyLayer());
    expect([...packLayer(emptyLayer()).toUint8Array()]).toEqual([...empty]);
  });

  it("roundtrips the complete authored model losslessly", () => {
    const expected = fullLayer();
    const packed = packLayer(expected);
    const decoded = packed.unpack();

    expect(packed.id).toBe(expected.id);
    expect(packed.sourceId).toBe(expected.sourceId);
    expect(packed.width).toBe(expected.width);
    expect(packed.height).toBe(expected.height);
    expect(packed.contourCount).toBe(2);
    expect(packed.pointCount).toBe(3);
    expect(packed.componentCount).toBe(1);
    expect(packed.anchorCount).toBe(2);
    expect(packed.guidelineCount).toBe(2);
    expect(decoded).toEqual(expected);
    expect(Object.is(decoded.contours[0].points[0].y, -0)).toBe(true);
  });

  it("streams one contour and entity at a time", () => {
    const packed = packLayer(fullLayer());
    const contours = [...packed.contours()];

    expect(contours[0].id).toBe("contour_outer");
    expect(contours[0].closed).toBe(true);
    expect([...contours[0].points()].map((point) => [point.id, point.type])).toEqual([
      ["point_0", "on-curve"],
      ["point_1", "off-curve"],
      ["point_2", "qcurve"],
    ]);
    expect([...packed.components()][0].baseGlyphId).toBe("glyph_acute");
    expect([...packed.anchors()][1].name).toBeNull();
    expect([...packed.guidelines()][0].y).toBe(0);
  });

  it("encodes dictionaries canonically regardless of insertion order", () => {
    const first = fullLayer();
    const second = { ...fullLayer(), lib: new Map([...fullLayer().lib].reverse()) };

    expect([...packLayer(first).toUint8Array()]).toEqual([...packLayer(second).toUint8Array()]);
  });

  it("orders dictionary keys by UTF-8 bytes across the BMP boundary", () => {
    const layer: GlyphLayer = {
      ...emptyLayer(),
      lib: new Map([
        ["\u{10000}", { kind: "string", value: "astral" }],
        ["\uffff", { kind: "string", value: "bmp" }],
      ]),
    };

    const decoded = decodeLayer(packLayer(layer).toUint8Array()).unpack();

    expect([...decoded.lib.keys()]).toEqual(["\uffff", "\u{10000}"]);
  });

  it("does not expose mutable validated storage", () => {
    const source = packLayer(fullLayer()).toUint8Array();
    const layer = decodeLayer(source);
    const exported = layer.toUint8Array();
    source[0] = 0;
    exported[1] = 0;

    expect(layer.id).toBe("layer_A_regular");
    expect(layer.pointCount).toBe(3);
  });
});

describe("strict layer decoding", () => {
  it("rejects every truncation and trailing bytes", () => {
    const bytes = packLayer(fullLayer()).toUint8Array();
    for (let length = 0; length < bytes.length; length += 1) {
      expect(errorCode(() => decodeLayer(bytes.slice(0, length)))).not.toBeNull();
    }

    expect(errorCode(() => decodeLayer(Uint8Array.from([...bytes, 0])))).toBe("length-mismatch");
  });

  it("rejects framing, unknown flags and point types", () => {
    const seed = packLayer(fullLayer()).toUint8Array();
    const cases: ReadonlyArray<readonly [number, number, GlyphCodecErrorCode]> = [
      [0, 0, "wrong-magic"],
      [4, 1, "unsupported-kind"],
      [5, 2, "unsupported-version"],
      [6, 1, "unknown-flags"],
      [52, 2, "unknown-layer-flags"],
      [stringSectionEnd(seed) + 12 + 4, 3, "unknown-point-type"],
    ];

    for (const [offset, value, code] of cases) {
      const bytes = seed.slice();
      bytes[offset] = value;
      expect(errorCode(() => decodeLayer(bytes))).toBe(code);
    }
  });

  it("rejects non-canonical absent numeric slots", () => {
    const bytes = packLayer(emptyLayer()).toUint8Array();
    bytes[71] = 0x80;

    expect(errorCode(() => decodeLayer(bytes))).toBe("non-canonical-absent-number");
  });

  it("rejects non-finite numbers, duplicate identity, and out-of-range integers", () => {
    const source = fullLayer();
    const [firstContour, ...otherContours] = source.contours;
    const [firstPoint, secondPoint, ...otherPoints] = firstContour.points;
    const nonfinite: GlyphLayer = {
      ...source,
      contours: [
        {
          ...firstContour,
          points: [{ ...firstPoint, x: Number.NaN }, secondPoint, ...otherPoints],
        },
        ...otherContours,
      ],
    };
    expect(errorCode(() => packLayer(nonfinite))).toBe("non-finite-number");

    const duplicate: GlyphLayer = {
      ...source,
      contours: [
        {
          ...firstContour,
          points: [firstPoint, { ...secondPoint, id: firstPoint.id }, ...otherPoints],
        },
        ...otherContours,
      ],
    };
    expect(errorCode(() => packLayer(duplicate))).toBe("duplicate-identity");

    const integer: GlyphLayer = {
      ...source,
      lib: new Map([["too-large", { kind: "uid", value: 1n << 64n }]]),
    };
    expect(errorCode(() => packLayer(integer))).toBe("integer-out-of-range");
  });

  it("never accepts a mutated non-canonical payload", () => {
    const seed = packLayer(fullLayer()).toUint8Array();
    let random = 0x81d2_67a5;

    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      const candidate = seed.slice();
      const offset = (random >>> 0) % candidate.length;
      candidate[offset] ^= ((random >>> 24) | 1) & 0xff;
      const mutated =
        iteration % 7 === 0
          ? candidate.slice(0, (random >>> 0) % candidate.length)
          : iteration % 11 === 0
            ? Uint8Array.from([...candidate, (random >>> 16) & 0xff])
            : candidate;

      try {
        const layer = decodeLayer(mutated);
        if (!bytesEqual(packLayer(layer.unpack()).toUint8Array(), mutated)) {
          throw new Error("decoder accepted a non-canonical layer encoding");
        }
      } catch (error) {
        if (!(error instanceof GlyphCodecError)) throw error;
      }
    }
  });
});
