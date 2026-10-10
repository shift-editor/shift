import type {
  AuthoredKerningPair,
  AxisCoordinate,
  KerningGlyph,
  KerningGroupSummary,
  KerningMasterValue,
  KerningPairPage,
  KerningPairQuery,
  KerningPairSide,
  KerningResolution,
  KerningRule,
  ResolvedKerningPairs,
} from "@shift/runtime";
import { isGlyphId, type GlyphId, type KerningPosition, type SourceId } from "@shift/types";
import {
  isGroupSide,
  type Font,
  type KerningPairSides,
  type KerningSideId,
  type ResolvedKerning,
} from "@shift/editor/model";

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

  constructor(font: Font) {
    this.#font = font;
  }

  /** Returns the font's kerning groups, first-position groups first, each side in name order. */
  groups(position?: KerningPosition): KerningGroupSummary[] {
    const groups = this.#font.kerningCell.peek().groups;
    const positions: KerningPosition[] = position ? [position] : ["first", "second"];

    return positions.flatMap((at) =>
      groups.atPosition(at).map((group) => ({
        groupId: group.id,
        name: group.name,
        position: group.position,
        members: group.glyphIds.map((glyphId) => this.#glyph(glyphId)),
      })),
    );
  }

  /**
   * Lists one page of the pairs authored at a source, ordered by side ids.
   *
   * @param glyph - Keeps only pairs naming this glyph, or its group at that pair position.
   * @throws {Error} for an unknown source or glyph, an invalid limit, or a malformed cursor.
   */
  pairs({
    sourceId,
    glyph,
    limit = 100,
    cursor,
  }: {
    sourceId: SourceId;
    glyph?: string;
    limit?: number;
    cursor?: string;
  }): KerningPairPage {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("kerning.pairs limit must be between 1 and 500");
    }
    if (!this.#font.source(sourceId)) throw new Error(`Source ${sourceId} is not in this font`);

    const kerning = this.#font.kerningCell.peek();
    const appliesTo = glyph ? this.#pairFilter(this.#glyphId(glyph)) : () => true;
    const pairs = kerning.authoredPairs(sourceId).filter(appliesTo).sort(comparePairs);
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
    target: { sourceId?: SourceId; location?: AxisCoordinate[] },
  ): ResolvedKerningPairs {
    const font = this.#font;
    const { sourceId, location } = target;
    if (sourceId && location)
      throw new Error("kerning.resolve takes sourceId or location, not both");
    if (sourceId && !font.source(sourceId))
      throw new Error(`Source ${sourceId} is not in this font`);

    const external = location ? font.designspace.location(location) : font.defaultLocation();
    const items = queries.map(({ first, second }): KerningResolution => {
      const firstId = this.#glyphId(first);
      const secondId = this.#glyphId(second);
      return {
        first: this.#glyph(firstId),
        second: this.#glyph(secondId),
        amount: font.kerningBetween(firstId, secondId, external, sourceId ?? null),
        masters: font.sources.map((source) => this.#masterValue(source.id, firstId, secondId)),
      };
    });
    return { items };
  }

  #masterValue(sourceId: SourceId, first: GlyphId, second: GlyphId): KerningMasterValue {
    const font = this.#font;
    const kerning = font.kerningCell.peek();
    const amount = font.kerningBetween(first, second, font.defaultLocation(), sourceId);
    const applied = kerning.resolve(sourceId, first, second);
    if (applied) {
      return {
        sourceId,
        amount,
        origin: "authored",
        rule: ruleOf(applied),
        pair: this.#authoredPair(applied),
      };
    }

    const kernsElsewhere = kerning.authors(sourceId) || font.sources.length === 1;
    return {
      sourceId,
      amount,
      origin: kernsElsewhere ? "unkerned" : "interpolated",
      rule: "none",
      pair: null,
    };
  }

  /** Whether a pair names `glyphId` on a side, directly or through its group there. */
  #pairFilter(glyphId: GlyphId): (pair: ResolvedKerning) => boolean {
    const kerning = this.#font.kerningCell.peek();
    const firstSides = new Set<KerningSideId>([glyphId]);
    const secondSides = new Set<KerningSideId>([glyphId]);
    const firstGroup = kerning.groupOf("first", glyphId);
    const secondGroup = kerning.groupOf("second", glyphId);
    if (firstGroup) firstSides.add(firstGroup);
    if (secondGroup) secondSides.add(secondGroup);

    return (pair) => firstSides.has(pair.first) || secondSides.has(pair.second);
  }

  #authoredPair(pair: ResolvedKerning): AuthoredKerningPair {
    return { first: this.#side(pair.first), second: this.#side(pair.second), amount: pair.amount };
  }

  #side(side: KerningSideId): KerningPairSide {
    if (!isGroupSide(side)) return { kind: "glyph", ...this.#glyph(side) };

    const group = this.#font.kerningCell.peek().groups.group(side);
    return { kind: "group", groupId: side, name: group?.name ?? side };
  }

  #glyph(glyphId: GlyphId): KerningGlyph {
    return { glyphId, name: this.#font.entryForId(glyphId)?.name ?? null };
  }

  /** Resolves an exact glyph name, or a stable id when the reference carries the glyph id prefix. */
  #glyphId(reference: string): GlyphId {
    const entry = isGlyphId(reference)
      ? this.#font.entryForId(reference)
      : this.#font.entryForName(reference);
    if (!entry) throw new Error(`Glyph ${reference} is not in this font`);
    return entry.id;
  }
}

function ruleOf(pair: ResolvedKerning): KerningRule {
  const firstIsGroup = isGroupSide(pair.first);
  const secondIsGroup = isGroupSide(pair.second);
  if (firstIsGroup && secondIsGroup) return "group";
  if (firstIsGroup || secondIsGroup) return "mixed";
  return "glyph";
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
