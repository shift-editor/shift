import {
  isKerningGroupId,
  type FontIntent,
  type GlyphId,
  type KerningGroup,
  type KerningGroupId,
  type KerningPairValue,
  type KerningSide,
  type KerningSnapshot,
  type KerningValueEdit,
  type SourceId,
  type SourceKerningPairs,
  byName,
  EntityMap,
  type ReadonlyEntityMap,
} from "@shift/types";
import type { FontEngine, KerningPlace } from "../../types/font";

/**
 * One side of a kerning pair, by id: a glyph or a kerning group. Glyph and
 * group ids carry different prefixes, so the id alone says which it is.
 */
export type KerningSideId = GlyphId | KerningGroupId;

/** A pair position: the glyph before the kern or the glyph after it. */
export type KerningPairPosition = "first" | "second";

/** An ordered kerning pair, independent of any source's value for it. */
export interface KerningPairSides {
  readonly first: KerningSideId;
  readonly second: KerningSideId;
}

/** The authored pair that applies between two glyphs at one source, and its value. */
export interface ResolvedKerning extends KerningPairSides {
  /** Font units added after the first glyph's advance. */
  readonly amount: number;
}

/** Whether a side names a group rather than a single glyph. */
export function isGroupSide(side: KerningSideId): side is KerningGroupId {
  return isKerningGroupId(side);
}

/**
 * Which kind of authored pair applies: two glyphs, two groups, or an
 * exception that names a glyph against a group.
 */
export type KerningPairRule = "glyph" | "group" | "exception";

/** The kind of pair `pair` is, from its sides. */
export function kerningRule(pair: KerningPairSides): KerningPairRule {
  const firstIsGroup = isGroupSide(pair.first);
  const secondIsGroup = isGroupSide(pair.second);
  if (firstIsGroup && secondIsGroup) return "group";
  if (firstIsGroup || secondIsGroup) return "exception";
  return "glyph";
}

/** A side as the wire spells it, with its kind. */
export function wireSide(side: KerningSideId): KerningSide {
  return { kind: isGroupSide(side) ? "group" : "glyph", id: side };
}

/** A value edit at one source for a pair, as the wire takes it; no amount removes the pair. */
export function kerningValueEdit(
  sourceId: SourceId,
  pair: KerningPairSides,
  amount?: number,
): KerningValueEdit {
  const edit = { sourceId, first: wireSide(pair.first), second: wireSide(pair.second) };
  return amount === undefined ? edit : { ...edit, amount };
}

/** The intent that sets each of `edits`' values, or removes the pair where it has no amount. */
export function setKerningValuesIntent(edits: readonly KerningValueEdit[]): FontIntent {
  return { kind: "setKerningValues", setKerningValues: { edits: [...edits] } };
}

/** Zero kerning for each pair of `pairs`, each pair's first glyph then its second: what nothing kerns. */
export function unkerned(pairs: readonly GlyphId[]): number[] {
  return Array.from({ length: pairs.length >> 1 }, () => 0);
}

const NO_GROUPS: readonly KerningGroup[] = [];

/** Each glyph's group at one pair position. */
type GroupMembership = ReadonlyMap<GlyphId, KerningGroupId>;

/** Each glyph's group at both pair positions. */
type MembershipByPosition = Readonly<Record<KerningPairPosition, GroupMembership>>;

/**
 * Font-wide kerning groups by id, with each glyph's group at each pair
 * position.
 */
export class KerningGroups {
  static readonly EMPTY = new KerningGroups(new Map(), { first: new Map(), second: new Map() });

  readonly #byId: ReadonlyEntityMap<KerningGroupId, KerningGroup>;
  readonly #membership: MembershipByPosition;
  readonly #byPosition: ReadonlyMap<KerningPairPosition, readonly KerningGroup[]>;

  private constructor(
    byId: ReadonlyMap<KerningGroupId, KerningGroup>,
    membership: MembershipByPosition,
  ) {
    this.#byId = new EntityMap("kerning group", byId);
    this.#membership = membership;
    this.#byPosition = Map.groupBy(byId.values().toArray().sort(byName), (group) => group.position);
  }

  static from(groups: readonly KerningGroup[]): KerningGroups {
    const byId = new Map<KerningGroupId, KerningGroup>();
    const membership = {
      first: new Map<GlyphId, KerningGroupId>(),
      second: new Map<GlyphId, KerningGroupId>(),
    };
    for (const group of groups) {
      byId.set(group.id, group);
      for (const glyphId of group.glyphIds) membership[group.position].set(glyphId, group.id);
    }
    return new KerningGroups(byId, membership);
  }

  /** The group with this id, or null when the font has none. */
  group(groupId: KerningGroupId): KerningGroup | null {
    return this.#byId.get(groupId);
  }

  /** The group `glyphId` kerns through at a pair position. */
  groupOf(position: KerningPairPosition, glyphId: GlyphId): KerningGroupId | null {
    return this.#membership[position].get(glyphId) ?? null;
  }
  /** The groups at a pair position, in name order; sorted once, when the groups change. */
  atPosition(position: KerningPairPosition): readonly KerningGroup[] {
    return this.#byPosition.get(position) ?? NO_GROUPS;
  }

  /** The group named `name` at a pair position; names are unique per position. */
  named(position: KerningPairPosition, name: string): KerningGroup | null {
    return this.atPosition(position).find((group) => group.name === name) ?? null;
  }
}

/**
 * What the font's records say about kerning: its groups, and the pairs each
 * source authors.
 *
 * @remarks
 * Records are data, not rules: which pair applies between two glyphs, and
 * what they kern at a location, come from the window's engine.
 */
export class KerningRecords {
  static readonly EMPTY = new KerningRecords(KerningGroups.EMPTY, []);

  readonly groups: KerningGroups;
  readonly #sources: readonly SourceKerningPairs[];

  private constructor(groups: KerningGroups, sources: readonly SourceKerningPairs[]) {
    this.groups = groups;
    this.#sources = sources;
  }

  /** Indexes a snapshot's groups; a missing snapshot is a font without kerning. */
  static from(snapshot: KerningSnapshot | null): KerningRecords {
    if (!snapshot) return KerningRecords.EMPTY;
    return new KerningRecords(KerningGroups.from(snapshot.groups), snapshot.sources);
  }

  /** Sources with at least one authored value. */
  get sourceIds(): SourceId[] {
    return this.#sources
      .filter((source) => source.pairs.length > 0)
      .map((source) => source.sourceId);
  }

  /** Whether `sourceId` authors at least one pair value. */
  authors(sourceId: SourceId): boolean {
    return (this.#pairsAt(sourceId)?.length ?? 0) > 0;
  }

  /** Returns every pair value authored at a source, in no set order; empty for a source without kerning. */
  authoredPairs(sourceId: SourceId): ResolvedKerning[] {
    return (this.#pairsAt(sourceId) ?? []).map(({ first, second, amount }) => ({
      first: first.id as KerningSideId,
      second: second.id as KerningSideId,
      amount,
    }));
  }

  #pairsAt(sourceId: SourceId): readonly KerningPairValue[] | null {
    return this.#sources.find((source) => source.sourceId === sourceId)?.pairs ?? null;
  }
}

/** The pair an edit between two glyphs at a source changes, and whether it applies there. */
interface EditableKerning {
  readonly authored: boolean;
  readonly kerning: ResolvedKerning;
}

/**
 * The font's kerning as the editor reads it: groups and authoring sources
 * from the font's records, and pair resolution and values from the window's
 * engine, which runs shift-font's rules over its own font.
 *
 * @remarks
 * Lookup follows UFO precedence, so a glyph exception beats its group pair,
 * and a location between sources blends what each source resolves, as the
 * compiled font does; both are decided in Rust. Without an engine nothing
 * kerns and nothing is authored.
 */
export class Kerning {
  static readonly EMPTY = new Kerning(KerningRecords.EMPTY, null);

  readonly #records: KerningRecords;
  readonly #engine: FontEngine | null;

  /**
   * @param records - The font's kerning records.
   * @param engine - The window's engine, which answers pair reads; null for none.
   */
  constructor(records: KerningRecords, engine: FontEngine | null) {
    this.#records = records;
    this.#engine = engine;
  }

  /** The font's kerning groups. */
  get groups(): KerningGroups {
    return this.#records.groups;
  }

  /** The group `glyphId` kerns through at a pair position. */
  groupOf(position: KerningPairPosition, glyphId: GlyphId): KerningGroupId | null {
    return this.#records.groups.groupOf(position, glyphId);
  }

  /** Sources with at least one authored value. */
  get sourceIds(): SourceId[] {
    return this.#records.sourceIds;
  }

  /** Whether `sourceId` authors at least one pair value. */
  authors(sourceId: SourceId): boolean {
    return this.#records.authors(sourceId);
  }

  /** Returns every pair value authored at a source; empty for a source without kerning. */
  authoredPairs(sourceId: SourceId): ResolvedKerning[] {
    return this.#records.authoredPairs(sourceId);
  }

  /**
   * The pairs authored at a source that name `glyphId` on a side, directly or
   * through its group at that side, in no set order.
   */
  pairsNaming(sourceId: SourceId, glyphId: GlyphId): ResolvedKerning[] {
    return this.#engine?.kerningPairsNaming(sourceId, glyphId) ?? [];
  }

  /**
   * Reads the kerning between glyph pairs at one place, in one engine call.
   *
   * @param pairs - Each pair's first glyph then its second.
   * @returns One value per pair, in font units.
   */
  between(pairs: readonly GlyphId[], place: KerningPlace): readonly number[] {
    if (!this.#engine) return unkerned(pairs);
    return this.#engine.kerningRun(pairs, place);
  }

  /**
   * The authored pair between `first` then `second` at one source, in UFO
   * precedence: glyph/glyph, glyph/group, group/glyph, group/group.
   *
   * @returns null when no pair applies at that source.
   */
  resolve(sourceId: SourceId, first: GlyphId, second: GlyphId): ResolvedKerning | null {
    const [pair] = this.#pairs(sourceId, [first, second]);
    return pair?.authored ? pair.kerning : null;
  }

  /**
   * The pair an edit between two glyphs at a source changes: the one that
   * applies there, or else the most general one their groups allow.
   *
   * @returns The pair with its current value, zero when it is not authored yet.
   */
  editablePair(sourceId: SourceId, first: GlyphId, second: GlyphId): ResolvedKerning {
    return this.editablePairs(sourceId, [first, second])[0]!;
  }

  /**
   * {@link editablePair} for each glyph pair, in one engine call.
   *
   * @param pairs - Each pair's first glyph then its second.
   */
  editablePairs(sourceId: SourceId, pairs: readonly GlyphId[]): ResolvedKerning[] {
    return this.#pairs(sourceId, pairs).map((pair) => pair.kerning);
  }

  /**
   * The edit at one source that makes a side of the pair between two glyphs a
   * glyph exception (`exception` true) or returns it to its group (false).
   *
   * @remarks
   * An exception starts at the value the pair has there now, so the kern does
   * not move. Returning removes the exception, so the group pair applies
   * again. Other sources are untouched: exceptions are per source, like values.
   *
   * @param pair - The pair currently edited between the two glyphs at `sourceId`.
   * @returns null when the side is already as asked or the glyph has no group there.
   */
  exceptionEdit(
    sourceId: SourceId,
    first: GlyphId,
    second: GlyphId,
    pair: ResolvedKerning,
    position: KerningPairPosition,
    exception: boolean,
  ): KerningValueEdit | null {
    const glyphId = position === "first" ? first : second;
    if (!this.groupOf(position, glyphId)) return null;
    if (!isGroupSide(pair[position]) === exception) return null;

    if (!exception) return kerningValueEdit(sourceId, pair);
    const sides = position === "first" ? { ...pair, first: glyphId } : { ...pair, second: glyphId };
    return kerningValueEdit(sourceId, sides, pair.amount);
  }

  /** Each glyph pair's editable pair at a source, with its sides named and whether it applies. */
  #pairs(sourceId: SourceId, pairs: readonly GlyphId[]): EditableKerning[] {
    const read = this.#engine?.kerningPairs(sourceId, pairs) ?? [];
    const named: EditableKerning[] = [];
    for (let index = 0; index + 1 < pairs.length; index += 2) {
      const first = pairs[index]!;
      const second = pairs[index + 1]!;
      const pair = read[index >> 1];
      named.push({
        authored: pair?.authored ?? false,
        kerning: {
          first: pair?.firstGroup ? (this.groupOf("first", first) ?? first) : first,
          second: pair?.secondGroup ? (this.groupOf("second", second) ?? second) : second,
          amount: pair?.amount ?? 0,
        },
      });
    }
    return named;
  }
}
