import type {
  Axis,
  GlyphId,
  InterpolationBasis,
  KerningSide,
  KerningSnapshot,
  KerningValueEdit,
  SourceId,
} from "@shift/types";
import { interpolationWeights } from "../interpolation/InterpolationBasis";
import type { DesignAxisLocation } from "../../types/variation";

/** An ordered kerning pair, independent of any source's value for it. */
export interface KerningPairSides {
  readonly first: KerningSide;
  readonly second: KerningSide;
}

/** The authored pair that applies between two glyphs at one source, and its value. */
export interface ResolvedKerning extends KerningPairSides {
  /** Font units added after the first glyph's advance. */
  readonly amount: number;
}

/** A pair position: the glyph before the kern or the glyph after it. */
export type KerningPairPosition = "first" | "second";

type SourceValues = ReadonlyMap<string, number>;
/** Pending values over a snapshot; null removes a pair. */
type SourceOverrides = ReadonlyMap<string, number | null>;

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
 * {@link withEdits} layers values that are not committed yet (a drag preview,
 * an edit waiting for its workspace echo) over the snapshot without copying it.
 */
export class Kerning {
  static readonly EMPTY = new Kerning(new Map(), new Map(), new Map(), new Map(), null);

  readonly #firstGroupOf: ReadonlyMap<GlyphId, string>;
  readonly #secondGroupOf: ReadonlyMap<GlyphId, string>;
  readonly #valuesBySource: ReadonlyMap<SourceId, SourceValues>;
  readonly #overridesBySource: ReadonlyMap<SourceId, SourceOverrides>;
  readonly #basis: InterpolationBasis | null;

  private constructor(
    firstGroupOf: ReadonlyMap<GlyphId, string>,
    secondGroupOf: ReadonlyMap<GlyphId, string>,
    valuesBySource: ReadonlyMap<SourceId, SourceValues>,
    overridesBySource: ReadonlyMap<SourceId, SourceOverrides>,
    basis: InterpolationBasis | null,
  ) {
    this.#firstGroupOf = firstGroupOf;
    this.#secondGroupOf = secondGroupOf;
    this.#valuesBySource = valuesBySource;
    this.#overridesBySource = overridesBySource;
    this.#basis = basis;
  }

  /** Indexes a snapshot; a missing snapshot is a font without kerning. */
  static from(snapshot: KerningSnapshot | null): Kerning {
    if (!snapshot) return Kerning.EMPTY;

    const firstGroupOf = new Map<GlyphId, string>();
    const secondGroupOf = new Map<GlyphId, string>();
    for (const group of snapshot.groups) {
      const groupOf = group.position === "first" ? firstGroupOf : secondGroupOf;
      for (const glyphId of group.glyphIds) groupOf.set(glyphId, group.name);
    }

    const valuesBySource = new Map<SourceId, SourceValues>();
    for (const source of snapshot.sources) {
      valuesBySource.set(
        source.sourceId,
        new Map(source.pairs.map((pair) => [pairKey(pair.first, pair.second), pair.amount])),
      );
    }

    return new Kerning(
      firstGroupOf,
      secondGroupOf,
      valuesBySource,
      new Map(),
      snapshot.basis ?? null,
    );
  }

  /**
   * Returns this kerning with `edits` applied in order on top, sharing the
   * snapshot's indexes.
   */
  withEdits(edits: readonly KerningValueEdit[]): Kerning {
    if (edits.length === 0) return this;

    const overridesBySource = new Map<SourceId, Map<string, number | null>>();
    for (const [sourceId, overrides] of this.#overridesBySource) {
      overridesBySource.set(sourceId, new Map(overrides));
    }
    for (const edit of edits) {
      let overrides = overridesBySource.get(edit.sourceId);
      if (!overrides) {
        overrides = new Map();
        overridesBySource.set(edit.sourceId, overrides);
      }
      overrides.set(pairKey(edit.first, edit.second), edit.amount ?? null);
    }

    return new Kerning(
      this.#firstGroupOf,
      this.#secondGroupOf,
      this.#valuesBySource,
      overridesBySource,
      this.#basis,
    );
  }

  /** The group `glyphId` kerns with at a pair position. */
  groupOf(position: KerningPairPosition, glyphId: GlyphId): string | null {
    const groups = position === "first" ? this.#firstGroupOf : this.#secondGroupOf;
    return groups.get(glyphId) ?? null;
  }

  /** Sources with at least one authored value. */
  get sourceIds(): SourceId[] {
    const sourceIds = new Set([...this.#valuesBySource.keys(), ...this.#overridesBySource.keys()]);
    return [...sourceIds].filter((sourceId) => this.authors(sourceId));
  }

  /** Whether `sourceId` authors at least one pair value. */
  authors(sourceId: SourceId): boolean {
    const overrides = this.#overridesBySource.get(sourceId);
    if (overrides && [...overrides.values()].some((amount) => amount !== null)) return true;

    const values = this.#valuesBySource.get(sourceId);
    if (!values) return false;
    if (!overrides) return values.size > 0;
    return [...values.keys()].some((key) => !overrides.has(key));
  }

  /** The amount authored for exactly this pair at a source; null when it has none. */
  authoredAmount(sourceId: SourceId, pair: KerningPairSides): number | null {
    const key = pairKey(pair.first, pair.second);
    const override = this.#overridesBySource.get(sourceId)?.get(key);
    if (override !== undefined) return override;
    return this.#valuesBySource.get(sourceId)?.get(key) ?? null;
  }

  /**
   * Resolves the authored pair between `first` followed by `second` at one source.
   *
   * @returns null when no pair applies at that source.
   */
  resolve(sourceId: SourceId, first: GlyphId, second: GlyphId): ResolvedKerning | null {
    for (const candidate of this.#candidates(first, second)) {
      const amount = this.authoredAmount(sourceId, candidate);
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
    if ((pair[position].kind === "glyph") === exception) return null;

    if (!exception) return { sourceId, first: pair.first, second: pair.second };
    const side: KerningSide = { kind: "glyph", id: glyphId };
    const sides = position === "first" ? { ...pair, first: side } : { ...pair, second: side };
    return { sourceId, first: sides.first, second: sides.second, amount: pair.amount };
  }

  /** Pairs between two glyphs from most to least specific, in UFO order. */
  #candidates(first: GlyphId, second: GlyphId): KerningPairSides[] {
    const firstGlyph: KerningSide = { kind: "glyph", id: first };
    const secondGlyph: KerningSide = { kind: "glyph", id: second };
    const firstGroupName = this.#firstGroupOf.get(first);
    const secondGroupName = this.#secondGroupOf.get(second);
    const firstGroup: KerningSide | null = firstGroupName
      ? { kind: "group", id: firstGroupName }
      : null;
    const secondGroup: KerningSide | null = secondGroupName
      ? { kind: "group", id: secondGroupName }
      : null;

    const candidates: KerningPairSides[] = [{ first: firstGlyph, second: secondGlyph }];
    if (secondGroup) candidates.push({ first: firstGlyph, second: secondGroup });
    if (firstGroup) candidates.push({ first: firstGroup, second: secondGlyph });
    if (firstGroup && secondGroup) candidates.push({ first: firstGroup, second: secondGroup });
    return candidates;
  }
}

function pairKey(first: KerningSide, second: KerningSide): string {
  return `${sideKey(first)}\u0000${sideKey(second)}`;
}

function sideKey(side: KerningSide): string {
  return side.kind === "glyph" ? `g:${side.id}` : `@:${side.id}`;
}
