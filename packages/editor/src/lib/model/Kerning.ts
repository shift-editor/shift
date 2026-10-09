import type {
  Axis,
  GlyphId,
  InterpolationBasis,
  KerningGroup,
  KerningGroupId,
  KerningPairValue,
  KerningSnapshot,
  SourceId,
} from "@shift/types";
import { interpolationWeights } from "../interpolation/InterpolationBasis";
import type { DesignAxisLocation } from "../../types/variation";

/**
 * One side of a kerning pair, by id: a glyph or a kerning group. Glyph and
 * group ids carry different prefixes, so the id alone says which it is.
 */
export type KerningSideId = GlyphId | KerningGroupId;

/** A pair position: the glyph before the kern or the glyph after it. */
export type KerningPairPosition = "first" | "second";

/** The authored pair that applies between two glyphs at one source, and its value. */
export interface ResolvedKerning {
  readonly first: KerningSideId;
  readonly second: KerningSideId;
  /** Font units added after the first glyph's advance. */
  readonly amount: number;
}

/** Each glyph's group at one pair position. */
type GroupMembership = ReadonlyMap<GlyphId, KerningGroupId>;

/** Each glyph's group at both pair positions. */
type MembershipByPosition = Readonly<Record<KerningPairPosition, GroupMembership>>;

/** One source's pair values: first side → second side → amount. */
type PairIndex = ReadonlyMap<KerningSideId, ReadonlyMap<KerningSideId, number>>;

/**
 * Font-wide kerning groups by id, with each glyph's group at each pair
 * position.
 */
export class KerningGroups {
  static readonly EMPTY = new KerningGroups(new Map(), { first: new Map(), second: new Map() });

  readonly #byId: ReadonlyMap<KerningGroupId, KerningGroup>;
  readonly #membership: MembershipByPosition;

  private constructor(
    byId: ReadonlyMap<KerningGroupId, KerningGroup>,
    membership: MembershipByPosition,
  ) {
    this.#byId = byId;
    this.#membership = membership;
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
    return this.#byId.get(groupId) ?? null;
  }

  /** The group `glyphId` kerns through at a pair position. */
  groupOf(position: KerningPairPosition, glyphId: GlyphId): KerningGroupId | null {
    return this.#membership[position].get(glyphId) ?? null;
  }
}

/** One source's authored pair values, indexed first side → second side. */
export class SourceKerning {
  readonly #values: PairIndex;

  private constructor(values: PairIndex) {
    this.#values = values;
  }

  static from(pairs: readonly KerningPairValue[]): SourceKerning {
    const values = new Map<KerningSideId, Map<KerningSideId, number>>();
    for (const { first, second, amount } of pairs) {
      rowOf(values, first.id as KerningSideId).set(second.id as KerningSideId, amount);
    }
    return new SourceKerning(values);
  }

  /** The value authored for exactly this pair, or null when it has none. */
  amount(first: KerningSideId, second: KerningSideId): number | null {
    return this.#values.get(first)?.get(second) ?? null;
  }
}

/**
 * Immutable kerning lookup over one workspace kerning snapshot.
 *
 * @remarks
 * Groups are font-wide and values are per source, as Rust stores them. Lookup
 * follows UFO precedence, so a glyph exception beats its group pair. Between
 * sources, each basis source resolves the pair on its own (falling back
 * through its groups, then to zero) and the results are blended, which is
 * what the compiled font does.
 */
export class Kerning {
  static readonly EMPTY = new Kerning(KerningGroups.EMPTY, new Map(), null);

  readonly #groups: KerningGroups;
  readonly #sources: ReadonlyMap<SourceId, SourceKerning>;
  readonly #basis: InterpolationBasis | null;

  private constructor(
    groups: KerningGroups,
    sources: ReadonlyMap<SourceId, SourceKerning>,
    basis: InterpolationBasis | null,
  ) {
    this.#groups = groups;
    this.#sources = sources;
    this.#basis = basis;
  }

  /** Indexes a snapshot; a missing snapshot is a font without kerning. */
  static from(snapshot: KerningSnapshot | null): Kerning {
    if (!snapshot) return Kerning.EMPTY;
    const sources = new Map(
      snapshot.sources.map((source) => [source.sourceId, SourceKerning.from(source.pairs)]),
    );
    return new Kerning(KerningGroups.from(snapshot.groups), sources, snapshot.basis ?? null);
  }

  /** The font's kerning groups. */
  get groups(): KerningGroups {
    return this.#groups;
  }

  /**
   * The authored pair between `first` then `second` at one source, in UFO
   * precedence: glyph/glyph, glyph/group, group/glyph, group/group.
   *
   * @returns null when no pair applies at that source.
   */
  resolve(sourceId: SourceId, first: GlyphId, second: GlyphId): ResolvedKerning | null {
    const values = this.#sources.get(sourceId);
    if (!values) return null;

    for (const [candidateFirst, candidateSecond] of this.#candidates(first, second)) {
      const amount = values.amount(candidateFirst, candidateSecond);
      if (amount !== null) return { first: candidateFirst, second: candidateSecond, amount };
    }
    return null;
  }

  /** The kerning between two glyphs at one source; zero when no pair applies. */
  valueAtSource(sourceId: SourceId, first: GlyphId, second: GlyphId): number {
    return this.resolve(sourceId, first, second)?.amount ?? 0;
  }

  /**
   * The kerning between two glyphs at a design location between sources.
   *
   * @returns null for a font without an interpolation basis (a static font),
   * whose callers resolve at a source instead.
   */
  valueAtLocation(
    location: DesignAxisLocation,
    axes: readonly Axis[],
    first: GlyphId,
    second: GlyphId,
  ): number | null {
    const basis = this.#basis;
    if (!basis) return null;

    const weights = interpolationWeights(basis, location, axes);
    let amount = 0;
    for (const [index, sourceId] of basis.sourceIds.entries()) {
      const weight = weights[index] ?? 0;
      if (weight !== 0) amount += weight * this.valueAtSource(sourceId, first, second);
    }
    return amount;
  }

  /** The pairs that could apply between two glyphs, most specific first. */
  #candidates(first: GlyphId, second: GlyphId): Array<readonly [KerningSideId, KerningSideId]> {
    const firstGroup = this.#groups.groupOf("first", first);
    const secondGroup = this.#groups.groupOf("second", second);

    const candidates: Array<readonly [KerningSideId, KerningSideId]> = [[first, second]];
    if (secondGroup) candidates.push([first, secondGroup]);
    if (firstGroup) candidates.push([firstGroup, second]);
    if (firstGroup && secondGroup) candidates.push([firstGroup, secondGroup]);
    return candidates;
  }
}

/** The row for `first` in a nested pair index, created when missing. */
function rowOf<T>(
  rows: Map<KerningSideId, Map<KerningSideId, T>>,
  first: KerningSideId,
): Map<KerningSideId, T> {
  let row = rows.get(first);
  if (!row) {
    row = new Map();
    rows.set(first, row);
  }
  return row;
}
