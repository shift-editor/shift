import type { GlyphInfo } from "@shift/glyph-info";
import type { GlyphName } from "@shift/types";
import type { GlyphListResult, GlyphSet } from "@/types/glyphSet";

const GLYPH_NAME = /^(?:[A-Za-z_][A-Za-z0-9_.-]*|\.[A-Za-z0-9_.-]+)$/;

/** Resolve pasted glyph names, slash names, characters, and U+ codepoints without creating glyphs. */
export function parseGlyphList(input: string, glyphInfo: GlyphInfo): GlyphListResult {
  const glyphNames: GlyphName[] = [];
  const errors: string[] = [];

  for (const token of input.split(/[\s,]+/).filter(Boolean)) {
    if (token.includes("=") || (token.includes("+") && !/^\/?U\+[0-9A-Fa-f]{4,6}$/i.test(token))) {
      errors.push(`${token}: component recipes are not supported yet`);
      continue;
    }

    const value = token.startsWith("/") ? token.slice(1) : token;
    const unicode = /^U\+([0-9A-Fa-f]{4,6})$/i.exec(value);
    if (unicode) {
      const codepoint = Number.parseInt(unicode[1], 16);
      if (codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
        errors.push(`${token}: invalid Unicode scalar`);
        continue;
      }
      glyphNames.push(nameForUnicode(codepoint, glyphInfo));
      continue;
    }

    if ([...value].length === 1 && !/^[A-Za-z_]$/.test(value)) {
      glyphNames.push(nameForUnicode(value.codePointAt(0)!, glyphInfo));
      continue;
    }

    if (!GLYPH_NAME.test(value)) {
      errors.push(`${token}: invalid glyph name`);
      continue;
    }
    glyphNames.push(value as GlyphName);
  }

  return { glyphNames: [...new Set(glyphNames)], errors };
}

export function nameForUnicode(codepoint: number, glyphInfo: GlyphInfo): GlyphName {
  const hex = codepoint.toString(16).toUpperCase().padStart(4, "0");
  return (glyphInfo.getGlyphName(codepoint) ?? `uni${hex}`) as GlyphName;
}

/** Combine selected sets and individual glyphs without duplicating a requested name. */
export function selectedGlyphNames(
  sets: readonly GlyphSet[],
  selectedSetIds: ReadonlySet<string>,
  individualNames: readonly GlyphName[],
  pastedNames: readonly GlyphName[],
): GlyphName[] {
  return [
    ...new Set([
      ...sets.filter((set) => selectedSetIds.has(set.id)).flatMap((set) => set.glyphNames),
      ...individualNames,
      ...pastedNames,
    ]),
  ];
}
