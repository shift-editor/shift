import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { GlyphId, KerningSnapshot, SourceId } from "@shift/types";
import { Kerning, type ResolvedKerning } from "@shift/editor/model";

interface ResolutionCase {
  readonly sourceId: SourceId;
  readonly first: GlyphId;
  readonly second: GlyphId;
  readonly expected: ResolvedKerning | null;
}

// Written by shift-wire's `kerning_resolution_fixture_matches_rust`: the
// snapshot Rust sends and Rust's own resolution of every pair in it.
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../packages/types/__fixtures__/kerning_resolution.json"),
    "utf8",
  ),
) as { snapshot: KerningSnapshot; cases: ResolutionCase[] };

describe("kerning resolution", () => {
  const kerning = Kerning.from(fixture.snapshot);

  it.each(fixture.cases)(
    "$first then $second at $sourceId resolves as Rust does",
    ({ sourceId, first, second, expected }) => {
      expect(kerning.resolve(sourceId, first, second)).toEqual(expected);
    },
  );
});
