import {
  isKerningGroupId,
  type Axis,
  type GlyphId,
  type InterpolationBasis,
  type KerningGroup,
  type KerningGroupId,
  type KerningPairValue,
  type KerningSide,
  type KerningSnapshot,
  type KerningValueEdit,
  type SourceId,
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
  /** The groups at a pair position, in name order. */
  atPosition(position: KerningPairPosition): KerningGroup[] {
    return [...this.#byId.values()]
      .filter((group) => group.position === position)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The group named `name` at a pair position; names are unique per position. */
  named(position: KerningPairPosition, name: string): KerningGroup | null {
    for (const group of this.#byId.values()) {
      if (group.position === position && group.name === name) return group;
    }
    return null;
  }
}

/** One source's pair values: first side → second side → `T`. */
type PairIndex<T> = ReadonlyMap<KerningSideId, ReadonlyMap<KerningSideId, T>>;

/** An edit to one pair at a source, as `SourceKerning` layers it: null removes the pair. */
interface PairEdit extends KerningPairSides {
  readonly amount: number | null;
}

/**
 * One source's pair values, indexed first side → second side, with edits not
 * committed yet (a drag preview, an edit waiting for its workspace echo)
 * layered over them.
 */
export class SourceKerning {
  static readonly EMPTY = new SourceKerning(new Map(), new Map());

  readonly #values: PairIndex<number>;
  readonly #edits: PairIndex<number | null>;

  private constructor(values: PairIndex<number>, edits: PairIndex<number | null>) {
    this.#values = values;
    this.#edits = edits;
  }

  static from(pairs: readonly KerningPairValue[]): SourceKerning {
    const values = new Map<KerningSideId, Map<KerningSideId, number>>();
    for (const { first, second, amount } of pairs) {
      rowOf(values, first.id as KerningSideId).set(second.id as KerningSideId, amount);
    }
    return new SourceKerning(values, new Map());
  }

  /** The value authored for exactly this pair, or null when it has none. */
  amount(first: KerningSideId, second: KerningSideId): number | null {
    const edited = this.#edits.get(first)?.get(second);
    if (edited !== undefined) return edited;
    return this.#values.get(first)?.get(second) ?? null;
  }

  /** Whether the source authors at least one pair value. */
  get authorsAny(): boolean {
    for (const row of this.#edits.values()) {
      for (const amount of row.values()) if (amount !== null) return true;
    }
    for (const [first, row] of this.#values) {
      for (const second of row.keys()) {
        if (this.#edits.get(first)?.get(second) !== null) return true;
      }
    }
    return false;
  }

  /** These values with `edits` applied in order on top, sharing the committed index. */
  withEdits(edits: readonly PairEdit[]): SourceKerning {
    const layered = new Map<KerningSideId, Map<KerningSideId, number | null>>();
    for (const [first, row] of this.#edits) layered.set(first, new Map(row));
    for (const edit of edits) rowOf(layered, edit.first).set(edit.second, edit.amount);
    return new SourceKerning(this.#values, layered);
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
 *
 * {@link withEdits} layers values that are not committed yet over the
 * snapshot without copying it.
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

  /** Returns this kerning with `edits` applied in order on top, sharing the snapshot's indexes. */
  withEdits(edits: readonly KerningValueEdit[]): Kerning {
    if (edits.length === 0) return this;

    const bySource = new Map<SourceId, PairEdit[]>();
    for (const edit of edits) {
      let sourceEdits = bySource.get(edit.sourceId);
      if (!sourceEdits) {
        sourceEdits = [];
        bySource.set(edit.sourceId, sourceEdits);
      }
      sourceEdits.push({
        first: edit.first.id as KerningSideId,
        second: edit.second.id as KerningSideId,
        amount: edit.amount ?? null,
      });
    }

    const sources = new Map(this.#sources);
    for (const [sourceId, sourceEdits] of bySource) {
      sources.set(sourceId, (sources.get(sourceId) ?? SourceKerning.EMPTY).withEdits(sourceEdits));
    }
    return new Kerning(this.#groups, sources, this.#basis);
  }

  /** The font's kerning groups. */
  get groups(): KerningGroups {
    return this.#groups;
  }

  /** The group `glyphId` kerns through at a pair position. */
  groupOf(position: KerningPairPosition, glyphId: GlyphId): KerningGroupId | null {
    return this.#groups.groupOf(position, glyphId);
  }

  /** Sources with at least one authored value. */
  get sourceIds(): SourceId[] {
    return [...this.#sources.keys()].filter((sourceId) => this.authors(sourceId));
  }

  /** Whether `sourceId` authors at least one pair value. */
  authors(sourceId: SourceId): boolean {
    return this.#sources.get(sourceId)?.authorsAny ?? false;
  }

  /** The amount authored for exactly this pair at a source; null when it has none. */
  authoredAmount(sourceId: SourceId, pair: KerningPairSides): number | null {
    return this.#sources.get(sourceId)?.amount(pair.first, pair.second) ?? null;
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

    for (const candidate of this.#candidates(first, second)) {
      const amount = values.amount(candidate.first, candidate.second);
      if (amount !== null) return { ...candidate, amount };
    }
    return null;
  }

  /**
   * The pair an edit between two glyphs at a source changes: the one that
   * applies there, or else the most general one their groups allow.
   *
   * @returns The pair with its current value, zero when it is not authored yet.
   */
  editablePair(sourceId: SourceId, first: GlyphId, second: GlyphId): ResolvedKerning {
    const resolved = this.resolve(sourceId, first, second);
    if (resolved) return resolved;

    const candidates = this.#candidates(first, second);
    return { ...candidates[candidates.length - 1]!, amount: 0 };
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

  /** The pairs that could apply between two glyphs, most specific first. */
  #candidates(first: GlyphId, second: GlyphId): KerningPairSides[] {
    const firstGroup = this.#groups.groupOf("first", first);
    const secondGroup = this.#groups.groupOf("second", second);

    const candidates: KerningPairSides[] = [{ first, second }];
    if (secondGroup) candidates.push({ first, second: secondGroup });
    if (firstGroup) candidates.push({ first: firstGroup, second });
    if (firstGroup && secondGroup) candidates.push({ first: firstGroup, second: secondGroup });
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
