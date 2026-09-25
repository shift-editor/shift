import { describe, expect, it } from "vitest";
import type { GlyphId, GlyphName, GlyphRecord } from "@shift/types";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { componentPickerGlyphs } from "./componentPicker";

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
      componentPickerGlyphs(glyphs, records, rootId, "", glyphInfo).map(({ id }) => id),
    ).toEqual([baseId]);
  });

  it.each(["base", "B", "U+0042", "uni0042"])("finds a glyph from %s", (query) => {
    expect(
      componentPickerGlyphs(glyphs, records, rootId, query, glyphInfo).map(({ id }) => id),
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
      componentPickerGlyphs(candidates, candidateRecords, currentId, "", glyphInfo).map(
        ({ id }) => id,
      ),
    ).toEqual([eId, acuteId, existingId, otherId]);
    expect(
      componentPickerGlyphs(candidates, candidateRecords, currentId, "e", glyphInfo).map(
        ({ id }) => id,
      ),
    ).toEqual([otherId, existingId, acuteId, eId]);
  });
});

function glyph(id: GlyphId, name: string, unicode: number): GlyphCatalogItem {
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
