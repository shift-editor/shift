import { describe, expect, it } from "vitest";
import type { GlyphId, GlyphName, GlyphRecord } from "@shift/types";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { componentPickerCandidates } from "./componentPicker";

const rootId = "glyph-root" as GlyphId;
const baseId = "glyph-base" as GlyphId;
const directDependentId = "glyph-direct" as GlyphId;
const indirectDependentId = "glyph-indirect" as GlyphId;
const glyphInfo = getGlyphInfo();

const glyphs: GlyphCatalogItem[] = [
  glyph(rootId, "root", 0x52),
  glyph(baseId, "base", 0x42),
  glyph(directDependentId, "direct", 0x44),
  glyph(indirectDependentId, "indirect", 0x49),
];

const records: GlyphRecord[] = [
  record(rootId),
  record(baseId),
  record(directDependentId, [rootId]),
  record(indirectDependentId, [directDependentId]),
];

describe("component picker candidates", () => {
  it("excludes the current glyph and direct or indirect dependents", () => {
    expect(
      componentPickerCandidates(glyphs, records, rootId, "", glyphInfo).flatMap((candidate) =>
        candidate.glyphId ? [candidate.glyphId] : [],
      ),
    ).toEqual([baseId]);
  });

  it.each(["base", "B", "U+0042", "uni0042"])("finds a glyph from %s", (query) => {
    expect(
      componentPickerCandidates(glyphs, records, rootId, query, glyphInfo).flatMap((candidate) =>
        candidate.glyphId ? [candidate.glyphId] : [],
      ),
    ).toEqual([baseId]);
  });

  it("ranks decomposition glyphs and existing component bases before the catalog", () => {
    const currentId = "glyph-eacute" as GlyphId;
    const eId = "glyph-e" as GlyphId;
    const acuteId = "glyph-acutecomb" as GlyphId;
    const existingId = "glyph-existing" as GlyphId;
    const otherId = "glyph-other" as GlyphId;
    const candidates = [
      glyph(otherId, "other", 0x4f),
      glyph(existingId, "existing", 0x58),
      glyph(acuteId, "acutecomb", 0x301),
      glyph(eId, "e", 0x65),
      glyph(currentId, "eacute", 0xe9),
    ];
    const candidateRecords = [
      record(currentId, [existingId]),
      record(eId),
      record(acuteId),
      record(existingId),
      record(otherId),
    ];

    expect(
      componentPickerCandidates(candidates, candidateRecords, currentId, "", glyphInfo).flatMap(
        (candidate) => (candidate.glyphId ? [candidate.glyphId] : []),
      ),
    ).toEqual([eId, acuteId, existingId, otherId]);
    expect(
      componentPickerCandidates(candidates, candidateRecords, currentId, "e", glyphInfo).flatMap(
        (candidate) => (candidate.glyphId ? [candidate.glyphId] : []),
      ),
    ).toEqual([eId, otherId, existingId, acuteId]);
  });

  it("offers matching Unicode glyphs that are missing from the font", () => {
    const candidates = componentPickerCandidates(glyphs, records, rootId, "aacute", glyphInfo);

    expect(candidates[0]).toEqual({
      availability: "missing",
      glyphId: null,
      name: "aacute",
      displayName: "aacute",
      unicode: 0x00e1,
    });
  });

  it("does not offer unrelated missing Unicode glyphs until the user searches", () => {
    expect(
      componentPickerCandidates(glyphs, records, rootId, "", glyphInfo).every(
        ({ availability }) => availability === "existing",
      ),
    ).toBe(true);
  });

  it("offers missing decomposition glyphs before unrelated existing glyphs", () => {
    const currentId = "glyph-aacute" as GlyphId;
    const candidates = componentPickerCandidates(
      [glyph(baseId, "base", 0x42), glyph(currentId, "aacute", 0x00e1)],
      [record(baseId), record(currentId)],
      currentId,
      "",
      glyphInfo,
    );

    expect(
      candidates.slice(0, 2).map(({ availability, unicode }) => ({ availability, unicode })),
    ).toEqual([
      { availability: "missing", unicode: 0x0061 },
      { availability: "missing", unicode: 0x0301 },
    ]);
  });

  it("does not duplicate an existing unencoded glyph as a missing Unicode glyph", () => {
    const aacuteId = "glyph-aacute" as GlyphId;
    const candidates = componentPickerCandidates(
      [...glyphs, glyph(aacuteId, "aacute", null)],
      [...records, record(aacuteId)],
      rootId,
      "aacute",
      glyphInfo,
    );

    expect(candidates.filter(({ name }) => name === "aacute")).toEqual([
      expect.objectContaining({ availability: "existing", glyphId: aacuteId }),
    ]);
  });
});

function glyph(id: GlyphId, name: string, unicode: number | null): GlyphCatalogItem {
  return {
    id,
    name: name as GlyphName,
    displayName: name,
    unicode,
  };
}

function record(id: GlyphId, componentBaseGlyphIds: GlyphId[] = []): GlyphRecord {
  return {
    id,
    name: id as unknown as GlyphName,
    unicodes: [],
    componentBaseGlyphIds,
    layers: [],
  };
}
