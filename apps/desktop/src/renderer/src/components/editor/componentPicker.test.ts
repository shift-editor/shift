import { beforeAll, describe, expect, it } from "vitest";
import type { GlyphId, GlyphName, GlyphRecord } from "@shift/types";
import type { ComponentCandidate } from "@/types/componentPicker";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { getGlyphInfo, loadComponentGlyphInfo } from "@/workspace/glyphInfo";
import { ComponentPicker } from "./componentPicker";

const rootId = "glyph-root" as GlyphId;
const baseId = "glyph-base" as GlyphId;
const directDependentId = "glyph-direct" as GlyphId;
const indirectDependentId = "glyph-indirect" as GlyphId;
const glyphInfo = getGlyphInfo();

// The picker loads decomposition and search data when it opens; so do these tests.
beforeAll(() => loadComponentGlyphInfo());

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
      pick(glyphs, records, rootId, "").flatMap((candidate) =>
        candidate.glyphId ? [candidate.glyphId] : [],
      ),
    ).toEqual([baseId]);
  });

  it.each(["base", "B", "U+0042", "uni0042"])("finds a glyph from %s", (query) => {
    expect(
      pick(glyphs, records, rootId, query).flatMap((candidate) =>
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
      pick(candidates, candidateRecords, currentId, "").flatMap((candidate) =>
        candidate.glyphId ? [candidate.glyphId] : [],
      ),
    ).toEqual([eId, acuteId, existingId, otherId]);
    expect(
      pick(candidates, candidateRecords, currentId, "e").flatMap((candidate) =>
        candidate.glyphId ? [candidate.glyphId] : [],
      ),
    ).toEqual([eId, otherId, existingId, acuteId]);
  });

  it("offers matching Unicode glyphs that are missing from the font", () => {
    const candidates = pick(glyphs, records, rootId, "aacute");

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
      pick(glyphs, records, rootId, "").every(({ availability }) => availability === "existing"),
    ).toBe(true);
  });

  it("offers missing decomposition glyphs before unrelated existing glyphs", () => {
    const currentId = "glyph-aacute" as GlyphId;
    const candidates = pick(
      [glyph(baseId, "base", 0x42), glyph(currentId, "aacute", 0x00e1)],
      [record(baseId), record(currentId)],
      currentId,
      "",
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
    const candidates = pick(
      [...glyphs, glyph(aacuteId, "aacute", null)],
      [...records, record(aacuteId)],
      rootId,
      "aacute",
    );

    expect(candidates.filter(({ name }) => name === "aacute")).toEqual([
      expect.objectContaining({ availability: "existing", glyphId: aacuteId }),
    ]);
  });

  it("stacks decomposition glyphs, component bases, then the catalog for an empty query", () => {
    const currentId = "glyph-aacute" as GlyphId;
    const acuteId = "glyph-acutecomb" as GlyphId;
    const existingId = "glyph-existing" as GlyphId;
    const otherId = "glyph-other" as GlyphId;
    const candidates = pick(
      [
        glyph(otherId, "other", 0x4f),
        glyph(existingId, "existing", 0x58),
        glyph(acuteId, "acutecomb", null),
        glyph(currentId, "aacute", 0xe1),
      ],
      [record(currentId, [existingId]), record(otherId), record(existingId), record(acuteId)],
      currentId,
      "",
    );

    expect(candidates.map(summary)).toEqual([
      "missing:a",
      "existing:acutecomb",
      "existing:existing",
      "existing:other",
    ]);
  });

  it("does not suggest a missing decomposition glyph the font has but cannot use", () => {
    const currentId = "glyph-aacute" as GlyphId;
    const aId = "glyph-a" as GlyphId;
    const candidates = pick(
      [glyph(aId, "a", 0x61), glyph(currentId, "aacute", 0xe1)],
      [record(aId, [currentId]), record(currentId)],
      currentId,
      "",
    );

    expect(candidates.map(summary)).toEqual(["missing:acutecomb"]);
  });

  it("suggests a missing glyph once when the decomposition repeats it", () => {
    const currentId = "glyph-ellipsis" as GlyphId;
    const candidates = pick(
      [glyph(currentId, "ellipsis", 0x2026)],
      [record(currentId)],
      currentId,
      "",
    );

    expect(candidates.map(summary)).toEqual(["missing:period"]);
  });

  it("ranks exact names, then code point matches, then other substring matches", () => {
    const exactId = "glyph-acute" as GlyphId;
    const encodedId = "glyph-foo" as GlyphId;
    const substringId = "glyph-acute-case" as GlyphId;
    const candidates = pick(
      [
        glyph(substringId, "acute.case", null),
        glyph(encodedId, "foo", 0x301),
        glyph(exactId, "acute", null),
        glyph(rootId, "root", 0x52),
      ],
      [record(substringId), record(encodedId), record(exactId), record(rootId)],
      rootId,
      "acute",
    );

    expect(candidates.slice(0, 3).map(summary)).toEqual([
      "existing:acute",
      "missing:acute-deva",
      "existing:foo",
    ]);
    expect(candidates.at(-1)).toEqual(expect.objectContaining({ glyphId: substringId }));
    expect(candidates.some(({ unicode }) => unicode === 0xb4)).toBe(false);
  });

  it("ranks the query's resolved glyph name before full-text search results", () => {
    expect(pick(glyphs, records, rootId, "acute").slice(0, 2).map(summary)).toEqual([
      "missing:acute",
      "missing:acute-deva",
    ]);
  });

  it("ranks the query's own character before full-text search results", () => {
    const candidates = pick([glyph(rootId, "root", 0x52)], [record(rootId)], rootId, "B");

    expect(candidates.slice(0, 2).map(({ unicode }) => unicode)).toEqual([0x42, 0x3105]);
  });

  it("lists every glyph that shares a code point", () => {
    const twinId = "glyph-twin" as GlyphId;
    const font = [...glyphs, glyph(twinId, "twin", 0x42)];
    const fontRecords = [...records, record(twinId)];

    expect(pick(font, fontRecords, rootId, "").map(({ glyphId }) => glyphId)).toEqual([
      baseId,
      twinId,
    ]);
    expect(
      pick(font, fontRecords, rootId, "B").flatMap(({ glyphId }) => (glyphId ? [glyphId] : [])),
    ).toEqual([twinId, baseId]);
  });
});

function pick(
  catalog: readonly GlyphCatalogItem[],
  glyphRecords: readonly GlyphRecord[],
  ownerId: GlyphId,
  query: string,
): ComponentCandidate[] {
  return ComponentPicker.for(catalog, glyphRecords, ownerId, glyphInfo).candidates(query);
}

function summary({ availability, name }: ComponentCandidate): string {
  return `${availability}:${name}`;
}

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
