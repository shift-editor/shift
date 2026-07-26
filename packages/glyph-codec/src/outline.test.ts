import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeOutline, GlyphCodecError, MAX_COMMAND_COUNT, packOutline } from "./outline";
import type { GlyphCodecErrorCode, OutlineCommand } from "./types";

type GoldenVector = {
  readonly name: string;
  readonly file: string;
  readonly commands: readonly OutlineCommand[];
};

const vectors: readonly GoldenVector[] = [
  { name: "empty", file: "empty.bin", commands: [] },
  {
    name: "closed-line",
    file: "closed-line.bin",
    commands: [{ kind: "move", x: 0, y: 0 }, { kind: "line", x: 100, y: 200 }, { kind: "close" }],
  },
  {
    name: "open",
    file: "open.bin",
    commands: [
      { kind: "move", x: -12.5, y: 0.25 },
      { kind: "line", x: 123.75, y: -456.5 },
    ],
  },
  {
    name: "quadratic-cubic",
    file: "quadratic-cubic.bin",
    commands: [
      { kind: "move", x: -1.5, y: 2.25 },
      { kind: "quad", cx: 0.5, cy: -0.75, x: 1000.125, y: -2000.5 },
      {
        kind: "cubic",
        c1x: -3,
        c1y: 4.5,
        c2x: 5.25,
        c2y: -6.75,
        x: 1e20,
        y: -1e20,
      },
      { kind: "close" },
    ],
  },
  {
    name: "multiple-contours",
    file: "multiple-contours.bin",
    commands: [
      { kind: "move", x: 0, y: 0 },
      { kind: "line", x: 10, y: 0 },
      { kind: "close" },
      { kind: "move", x: 100.5, y: -100.25 },
      { kind: "line", x: 200, y: 300 },
    ],
  },
];

function fixture(file: string): Uint8Array {
  return readFileSync(new URL(`../../../fixtures/glyph-codec/outline-v1/${file}`, import.meta.url));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function f32Commands(commands: readonly OutlineCommand[]): OutlineCommand[] {
  return commands.map((command) => {
    switch (command.kind) {
      case "move":
      case "line":
        return { kind: command.kind, x: Math.fround(command.x), y: Math.fround(command.y) };
      case "quad":
        return {
          kind: "quad",
          cx: Math.fround(command.cx),
          cy: Math.fround(command.cy),
          x: Math.fround(command.x),
          y: Math.fround(command.y),
        };
      case "cubic":
        return {
          kind: "cubic",
          c1x: Math.fround(command.c1x),
          c1y: Math.fround(command.c1y),
          c2x: Math.fround(command.c2x),
          c2y: Math.fround(command.c2y),
          x: Math.fround(command.x),
          y: Math.fround(command.y),
        };
      case "close":
        return command;
    }
  });
}

function rawOutline(commands: readonly number[], coordinates: readonly number[]): Uint8Array {
  const alignedCommands = Math.ceil(commands.length / 4) * 4;
  const bytes = new Uint8Array(16 + alignedCommands + coordinates.length * 4);
  bytes.set([0x53, 0x48, 0x46, 0x54, 1, 1], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, commands.length, true);
  view.setUint32(12, coordinates.length, true);
  bytes.set(commands, 16);
  coordinates.forEach((coordinate, index) =>
    view.setFloat32(16 + alignedCommands + index * 4, coordinate, true),
  );
  return bytes;
}

function codecErrorCode(action: () => unknown): GlyphCodecErrorCode | null {
  try {
    action();
    return null;
  } catch (error) {
    if (!(error instanceof GlyphCodecError)) throw error;
    return error.code;
  }
}

describe("shift.glyph-outline.v1 shared compatibility", () => {
  it.each(vectors)("decodes and canonically re-encodes $name", ({ file, commands }) => {
    const bytes = fixture(file);
    const outline = decodeOutline(bytes);

    expect([...outline]).toEqual(f32Commands(commands));
    expect([...packOutline(commands).toUint8Array()]).toEqual([...bytes]);
    expect([...packOutline([...outline]).toUint8Array()]).toEqual([...bytes]);
  });

  it("covers every command-count alignment remainder", () => {
    const remainders = vectors.map(({ file }) => decodeOutline(fixture(file)).commandCount % 4);

    expect(new Set(remainders)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("does not expose mutable validated storage", () => {
    const source = fixture("open.bin");
    const outline = decodeOutline(source);
    const exported = outline.toUint8Array();
    source[0] = 0;
    exported[1] = 0;

    expect([...outline]).toEqual(f32Commands(vectors[2].commands));
  });
});

describe("strict outline decoding", () => {
  it("rejects every truncation and trailing bytes", () => {
    const bytes = fixture("quadratic-cubic.bin");
    for (let length = 0; length < bytes.length; length += 1) {
      expect(codecErrorCode(() => decodeOutline(bytes.slice(0, length)))).not.toBeNull();
    }

    const trailing = new Uint8Array(bytes.length + 1);
    trailing.set(bytes);
    expect(codecErrorCode(() => decodeOutline(trailing))).toBe("length-mismatch");
  });

  it("rejects wrong framing and unknown flags", () => {
    const mutations: ReadonlyArray<readonly [number, number, GlyphCodecErrorCode]> = [
      [0, 0, "wrong-magic"],
      [4, 2, "unsupported-kind"],
      [5, 2, "unsupported-version"],
      [6, 1, "unknown-flags"],
    ];

    for (const [offset, value, code] of mutations) {
      const bytes = fixture("open.bin");
      bytes[offset] = value;
      expect(codecErrorCode(() => decodeOutline(bytes))).toBe(code);
    }
  });

  it("rejects unknown commands and illegal command transitions", () => {
    const cases: ReadonlyArray<readonly [Uint8Array, GlyphCodecErrorCode]> = [
      [rawOutline([9], []), "unknown-command"],
      [rawOutline([1], [1, 2]), "invalid-command-order"],
      [rawOutline([4], []), "invalid-command-order"],
      [rawOutline([0, 4], [0, 0]), "invalid-command-order"],
      [rawOutline([0, 1, 4, 1], [0, 0, 1, 1, 2, 2]), "invalid-command-order"],
    ];

    for (const [bytes, code] of cases) {
      expect(codecErrorCode(() => decodeOutline(bytes))).toBe(code);
    }
  });

  it("rejects arity mismatch and non-zero padding", () => {
    expect(codecErrorCode(() => decodeOutline(rawOutline([0, 1], [0, 0])))).toBe(
      "coordinate-count-mismatch",
    );

    const padding = fixture("open.bin");
    padding[18] = 1;
    expect(codecErrorCode(() => decodeOutline(padding))).toBe("non-zero-padding");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects decoded non-finite coordinate %s",
    (coordinate) => {
      expect(codecErrorCode(() => decodeOutline(rawOutline([0], [coordinate, 0])))).toBe(
        "non-finite-coordinate",
      );
    },
  );

  it("rejects illegally ordered encoder input", () => {
    const cases: ReadonlyArray<readonly OutlineCommand[]> = [
      [{ kind: "line", x: 1, y: 2 }],
      [{ kind: "close" }],
      [{ kind: "move", x: 0, y: 0 }, { kind: "close" }],
    ];

    for (const commands of cases) {
      expect(codecErrorCode(() => packOutline(commands))).toBe("invalid-command-order");
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite input coordinate %s",
    (x) => {
      expect(codecErrorCode(() => packOutline([{ kind: "move", x, y: 0 }]))).toBe(
        "non-finite-input-coordinate",
      );
    },
  );

  it("rejects finite values that overflow f32", () => {
    expect(codecErrorCode(() => packOutline([{ kind: "move", x: Number.MAX_VALUE, y: 0 }]))).toBe(
      "coordinate-out-of-f32-range",
    );
  });

  it("applies count limits before reading a declared body", () => {
    const bytes = fixture("empty.bin");
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      8,
      MAX_COMMAND_COUNT + 1,
      true,
    );

    expect(codecErrorCode(() => decodeOutline(bytes))).toBe("limit-exceeded");
  });

  it("never accepts a mutated payload with a non-canonical encoding", () => {
    const commands = vectors.flatMap((vector) => vector.commands);
    const seed = packOutline(commands).toUint8Array();
    let random = 0x7a114e29;

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
        const outline = decodeOutline(mutated);
        const canonical = packOutline([...outline]).toUint8Array();
        if (!bytesEqual(canonical, mutated)) {
          throw new Error("decoder accepted a non-canonical outline encoding");
        }
      } catch (error) {
        if (!(error instanceof GlyphCodecError)) throw error;
      }
    }
  });
});
