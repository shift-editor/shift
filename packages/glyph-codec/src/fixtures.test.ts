import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeLayer, packLayer } from "./layer";
import { decodeOutline, packOutline } from "./outline";
import type { OutlineCommand } from "./types";

type BinaryVector = {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
};

type LayerManifest = {
  readonly format: string;
  readonly vectors: readonly BinaryVector[];
};

type OutlineVector = BinaryVector & {
  readonly name: string;
  readonly commands: readonly ManifestCommand[];
};

type ManifestCommand = {
  readonly kind: string;
  readonly coordinates: readonly number[];
};

describe("canonical glyph-codec fixtures", () => {
  it("declares every layer fixture's length, digest, and canonical bytes", () => {
    const directory = fixtureUrl("layer-v1");
    const manifest = readJson<LayerManifest>(new URL("vectors.json", directory));
    expect(manifest.format).toBe("shift.glyph-layer.v1");
    expect(new Set(manifest.vectors.map((vector) => vector.file)).size).toBe(
      manifest.vectors.length,
    );

    for (const vector of manifest.vectors) {
      const bytes = readFileSync(new URL(vector.file, directory));
      expectBinaryFacts(bytes, vector);
      expect([...packLayer(decodeLayer(bytes).unpack()).toUint8Array()]).toEqual([...bytes]);
    }
  });

  it("declares every outline fixture's commands, length, digest, and canonical bytes", () => {
    const directory = fixtureUrl("outline-v1");
    const vectors = readJson<readonly OutlineVector[]>(new URL("vectors.json", directory));
    expect(new Set(vectors.map((vector) => vector.file)).size).toBe(vectors.length);
    expect(new Set(vectors.map((vector) => vector.name)).size).toBe(vectors.length);

    for (const vector of vectors) {
      const bytes = readFileSync(new URL(vector.file, directory));
      const commands = vector.commands.map(manifestCommand);
      expectBinaryFacts(bytes, vector);
      expect([...packOutline(commands).toUint8Array()]).toEqual([...bytes]);
      expect(decodeOutline(bytes).commandCount).toBe(commands.length);
    }
  });
});

function fixtureUrl(format: string): URL {
  return new URL(`../../../fixtures/glyph-codec/${format}/`, import.meta.url);
}

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

function expectBinaryFacts(bytes: Uint8Array, vector: BinaryVector): void {
  expect(bytes.byteLength, `${vector.file} byte length`).toBe(vector.bytes);
  expect(createHash("sha256").update(bytes).digest("hex"), `${vector.file} SHA-256`).toBe(
    vector.sha256,
  );
}

function manifestCommand(command: ManifestCommand): OutlineCommand {
  switch (command.kind) {
    case "move":
    case "line": {
      const [x, y] = command.coordinates;
      if (command.coordinates.length !== 2) throw new Error(`invalid ${command.kind} fixture`);
      return { kind: command.kind, x, y };
    }
    case "quad": {
      const [cx, cy, x, y] = command.coordinates;
      if (command.coordinates.length !== 4) throw new Error("invalid quad fixture");
      return { kind: "quad", cx, cy, x, y };
    }
    case "cubic": {
      const [c1x, c1y, c2x, c2y, x, y] = command.coordinates;
      if (command.coordinates.length !== 6) throw new Error("invalid cubic fixture");
      return { kind: "cubic", c1x, c1y, c2x, c2y, x, y };
    }
    case "close":
      if (command.coordinates.length !== 0) throw new Error("invalid close fixture");
      return { kind: "close" };
    default:
      throw new Error(`unknown fixture command ${command.kind}`);
  }
}
