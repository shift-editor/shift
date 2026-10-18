import { describe, expect, it } from "vitest";
import {
  asGlyphId,
  asKerningGroupId,
  asSourceId,
  type GlyphId,
  type KerningPairValue,
  type KerningSnapshot,
  type KerningValueEdit,
  type SourceId,
} from "@shift/types";
import { describeInput } from "../../testing/reference";
import { resolveKerning } from "@shift/wasm/reference";
import { Kerning, kerningValueEdit, type KerningSideId } from "./Kerning";

const glyph = (name: string) => asGlyphId(`glyph_${name}`);
const group = (name: string) => asKerningGroupId(`kerningGroup_${name}`);
const regular = asSourceId("source_regular");
const bold = asSourceId("source_bold");

function pair(first: KerningSideId, second: KerningSideId, amount: number): KerningPairValue {
  const { first: firstSide, second: secondSide } = kerningValueEdit(regular, { first, second });
  return { first: firstSide, second: secondSide, amount };
}

/**
 * Kerning that exercises every precedence level: a glyph pair, both
 * glyph/group exceptions, a group pair, an ungrouped glyph against a group,
 * both exceptions applying to one pair, a group authored on the side its
 * position does not kern, and a second source with only the group pair.
 */
const snapshot: KerningSnapshot = {
  groups: [
    {
      id: group("A"),
      position: "first",
      name: "A",
      glyphIds: [glyph("A"), glyph("Aacute"), glyph("Agrave")],
    },
    {
      id: group("V"),
      position: "second",
      name: "V",
      glyphIds: [glyph("V"), glyph("W"), glyph("Y")],
    },
    { id: group("O"), position: "second", name: "O", glyphIds: [glyph("A"), glyph("O")] },
  ],
  sources: [
    {
      sourceId: regular,
      pairs: [
        pair(group("A"), group("V"), -40),
        pair(group("A"), glyph("V"), -30),
        pair(glyph("A"), group("V"), -20),
        pair(glyph("A"), glyph("V"), -10),
        pair(glyph("T"), group("V"), -50),
        pair(glyph("Agrave"), group("V"), -60),
        pair(group("A"), glyph("W"), -70),
        pair(group("V"), glyph("A"), -90),
        pair(group("A"), group("O"), -15),
      ],
    },
    { sourceId: bold, pairs: [pair(group("A"), group("V"), -80)] },
  ],
};

/** Pending edits over the snapshot: a new exception, a changed value, and a removed pair. */
const edits: KerningValueEdit[] = [
  kerningValueEdit(regular, { first: glyph("Aacute"), second: glyph("Y") }, -5),
  kerningValueEdit(regular, { first: group("A"), second: group("V") }, -45),
  kerningValueEdit(regular, { first: glyph("A"), second: glyph("V") }),
  kerningValueEdit(bold, { first: glyph("T"), second: glyph("O") }, 12),
];

const sources = [regular, bold, asSourceId("source_missing")];
const firsts = ["A", "Aacute", "Agrave", "T", "V", "O"].map(glyph);
const seconds = ["V", "W", "Y", "A", "O", "T"].map(glyph);

interface ResolutionCase {
  readonly sourceId: SourceId;
  readonly first: GlyphId;
  readonly second: GlyphId;
  readonly edits: readonly KerningValueEdit[];
}

const cases: ResolutionCase[] = [[], edits].flatMap((pending) =>
  sources.flatMap((sourceId) =>
    firsts.flatMap((first) =>
      seconds.map((second) => ({ sourceId, first, second, edits: pending })),
    ),
  ),
);

describe("kerning precedence matches shift-font's Kerning::resolve", () => {
  const kerning = Kerning.from(snapshot);
  const edited = kerning.withEdits(edits);

  it.each(cases)(
    "$first then $second at $sourceId resolves as Rust does",
    ({ sourceId, first, second, edits: pending }) => {
      const resolver = pending.length > 0 ? edited : kerning;
      const expected = resolveKerning(snapshot, [...pending], sourceId, first, second) ?? null;

      expect(
        resolver.resolve(sourceId, first, second),
        `input ${describeInput({ sourceId, first, second, edits: pending })}`,
      ).toEqual(expected);
    },
  );
});
