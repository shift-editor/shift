import type {
  AuthoredKerningPair,
  AxisCoordinate,
  GlyphSelector,
  KerningGlyph,
  KerningGroupSummary,
  KerningMasterValue,
  KerningPairPage,
  KerningPairQuery,
  KerningPairSide,
  KerningResolution,
  ResolvedKerningPairs,
  SourceSelector,
} from "@shift/runtime";
import type { GlyphId, KerningGroup, KerningPosition, SourceId } from "@shift/types";
import {
  isGroupSide,
  kerningRule,
  type Font,
  type KerningPairSides,
  type KerningSideId,
  type ResolvedKerning,
} from "@shift/editor/model";
import { ShiftSelectors } from "./ShiftSelectors";

/**
 * Public kerning reads over one renderer's font.
 *
 * @remarks
 * Reads accepted kerning, including edits shown but not yet echoed, and
 * answers through the font's own lookup and blending so every value matches
 * what the editor shows and the compiled font applies. Revision guarding and
 * transport belong to the caller.
 */
export class ShiftKerningReader {
  readonly #font: Font;
  readonly #select: ShiftSelectors;

  constructor(font: Font) {
    this.#font = font;
    this.#select = new ShiftSelectors(font);
  }

  /** Returns the font's kerning groups, first-position groups first, each side in name order. */
  groups(position?: KerningPosition): KerningGroupSummary[] {
    const groups = this.#font.kerning.groups;
    const positions: KerningPosition[] = position ? [position] : ["first", "second"];

    return positions.flatMap((at) => groups.atPosition(at).map((group) => this.#group(group)));
  }

  /** The kerning group named `name` at a position, or null when the font has none. */
  group(position: KerningPosition, name: string): KerningGroupSummary | null {
    const group = this.#font.kerning.groups.named(position, name);
    return group ? this.#group(group) : null;
  }

  /**
   * The kerning group `glyph` belongs to at a position, or null when it kerns alone there.
   *
   * @throws {Error} when the font has no such glyph.
   */
  groupOf(position: KerningPosition, glyph: GlyphSelector): KerningGroupSummary | null {
    const groups = this.#font.kerning.groups;
    const groupId = groups.groupOf(position, this.#select.glyphId(glyph));
    const group = groupId ? groups.group(groupId) : null;
    return group ? this.#group(group) : null;
  }

  /**
   * Lists one page of the pairs authored at a source, the default source when
   * omitted, ordered by side ids.
   *
   * @param glyph - Keeps only pairs naming this glyph, or its group at that pair position.
   * @throws {Error} for an unknown source or glyph, an invalid limit, or a malformed cursor.
   */
  pairs({
    source,
    glyph,
    limit = 100,
    cursor,
  }: {
    source?: SourceSelector;
    glyph?: GlyphSelector;
    limit?: number;
    cursor?: string;
  }): KerningPairPage {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("kerning.pairs limit must be between 1 and 500");
    }
    const sourceId = this.#select.sourceId(source);

    const kerning = this.#font.kerning;
    const authored = glyph
      ? kerning.pairsNaming(sourceId, this.#select.glyphId(glyph))
      : kerning.authoredPairs(sourceId);
    const pairs = authored.sort(comparePairs);
    const after = cursor ? decodeCursor(cursor) : null;
    const start = after ? pairs.findIndex((pair) => comparePairs(pair, after) > 0) : 0;
    const remaining = start < 0 ? [] : pairs.slice(start);
    const page = remaining.slice(0, limit);
    const last = page.at(-1);

    return {
      sourceId,
      items: page.map((pair) => this.#authoredPair(pair)),
      nextCursor: remaining.length > limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * Resolves the kerning between glyph pairs at a master, a location, or the default location.
   *
   * @throws {Error} for an unknown glyph or source, or when both a source and a location are given.
   */
  resolve(
    queries: KerningPairQuery[],
    // oxlint-disable-next-line shift/no-optional-collection-field -- mirrors the agent protocol request
    target: { source?: SourceSelector; location?: AxisCoordinate[] },
  ): ResolvedKerningPairs {
    const font = this.#font;
    const { source, location } = target;
    if (source && location) throw new Error("kerning.resolve takes source or location, not both");
    const sourceId = source ? this.#select.sourceId(source) : null;

    const external = location ? font.designspace.location(location) : font.defaultLocation();
    const select = this.#select;
    const pairs = queries.flatMap(({ first, second }) => [
      select.glyphId(first),
      select.glyphId(second),
    ]);
    const amounts = font.kerningRun(pairs, external, sourceId);
    const items = queries.map((_, index): KerningResolution => {
      const firstId = pairs[2 * index]!;
      const secondId = pairs[2 * index + 1]!;
      return {
        first: this.#glyph(firstId),
        second: this.#glyph(secondId),
        amount: amounts[index] ?? 0,
        masters: font.sources.map((source) => this.#masterValue(source.id, firstId, secondId)),
      };
    });
    return { items };
  }

  /**
   * The kerning between two glyphs at one master, the default source when
   * `source` is omitted.
   *
   * @throws {Error} for an unknown glyph or source.
   */
  at({
    first,
    second,
    source,
  }: {
    first: GlyphSelector;
    second: GlyphSelector;
    source?: SourceSelector;
  }): KerningMasterValue {
    const select = this.#select;
    return this.#masterValue(
      select.sourceId(source),
      select.glyphId(first),
      select.glyphId(second),
    );
  }

  #masterValue(sourceId: SourceId, first: GlyphId, second: GlyphId): KerningMasterValue {
    const font = this.#font;
    const amount = font.kerningBetween(first, second, font.defaultLocation(), sourceId);
    const applied = font.kerning.resolve(sourceId, first, second);
    if (applied) {
      return {
        sourceId,
        amount,
        origin: "authored",
        rule: kerningRule(applied),
        pair: this.#authoredPair(applied),
      };
    }

    return {
      sourceId,
      amount,
      origin: font.missingPairOrigin(sourceId),
      rule: "none",
      pair: null,
    };
  }

  #group(group: KerningGroup): KerningGroupSummary {
    return {
      groupId: group.id,
      name: group.name,
      position: group.position,
      members: group.glyphIds.map((glyphId) => this.#glyph(glyphId)),
    };
  }

  #authoredPair(pair: ResolvedKerning): AuthoredKerningPair {
    return { first: this.#side(pair.first), second: this.#side(pair.second), amount: pair.amount };
  }

  #side(side: KerningSideId): KerningPairSide {
    if (!isGroupSide(side)) return { kind: "glyph", ...this.#glyph(side) };

    return { kind: "group", groupId: side, name: this.#font.kerningSideName(side) ?? side };
  }

  #glyph(glyphId: GlyphId): KerningGlyph {
    return { glyphId, name: this.#font.glyphName(glyphId) };
  }
}

function comparePairs(a: KerningPairSides, b: KerningPairSides): number {
  return compareIds(a.first, b.first) || compareIds(a.second, b.second);
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function encodeCursor({ first, second }: KerningPairSides): string {
  return btoa(JSON.stringify([first, second]));
}

function decodeCursor(cursor: string): KerningPairSides {
  let decoded: unknown;
  try {
    decoded = JSON.parse(atob(cursor));
  } catch {
    throw new Error("Invalid kerning pair cursor");
  }

  if (!isSideIdPair(decoded)) throw new Error("Invalid kerning pair cursor");
  const [first, second] = decoded;
  return { first: first as KerningSideId, second: second as KerningSideId };
}

function isSideIdPair(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) && value.length === 2 && value.every((side) => typeof side === "string")
  );
}
