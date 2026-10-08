import type {
  Axis,
  GlyphId,
  InterpolationBasis,
  KerningSide,
  KerningSnapshot,
  SourceId,
} from "@shift/types";
import { interpolationWeights } from "../interpolation/InterpolationBasis";
import type { DesignAxisLocation } from "../../types/variation";

/** The authored pair that applies between two glyphs at one source, and its value. */
export interface ResolvedKerning {
  readonly first: KerningSide;
  readonly second: KerningSide;
  /** Font units added after the first glyph's advance. */
  readonly amount: number;
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
  static readonly EMPTY = new Kerning(new Map(), new Map(), new Map(), null);

  readonly #firstGroupOf: ReadonlyMap<GlyphId, string>;
  readonly #secondGroupOf: ReadonlyMap<GlyphId, string>;
  readonly #valuesBySource: ReadonlyMap<SourceId, ReadonlyMap<string, number>>;
  readonly #basis: InterpolationBasis | null;

  private constructor(
    firstGroupOf: ReadonlyMap<GlyphId, string>,
    secondGroupOf: ReadonlyMap<GlyphId, string>,
    valuesBySource: ReadonlyMap<SourceId, ReadonlyMap<string, number>>,
    basis: InterpolationBasis | null,
  ) {
    this.#firstGroupOf = firstGroupOf;
    this.#secondGroupOf = secondGroupOf;
    this.#valuesBySource = valuesBySource;
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

    const valuesBySource = new Map<SourceId, ReadonlyMap<string, number>>();
    for (const source of snapshot.sources) {
      valuesBySource.set(
        source.sourceId,
        new Map(source.pairs.map((pair) => [pairKey(pair.first, pair.second), pair.amount])),
      );
    }

    return new Kerning(firstGroupOf, secondGroupOf, valuesBySource, snapshot.basis ?? null);
  }

  /** The group `glyphId` kerns with when it comes first in a pair. */
  firstGroupOf(glyphId: GlyphId): string | null {
    return this.#firstGroupOf.get(glyphId) ?? null;
  }

  /** The group `glyphId` kerns with when it comes second in a pair. */
  secondGroupOf(glyphId: GlyphId): string | null {
    return this.#secondGroupOf.get(glyphId) ?? null;
  }

  /**
   * Resolves the authored pair between `first` followed by `second` at one source.
   *
   * @returns null when no pair applies at that source.
   */
  resolve(sourceId: SourceId, first: GlyphId, second: GlyphId): ResolvedKerning | null {
    const values = this.#valuesBySource.get(sourceId);
    if (!values) return null;

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

    const candidates: Array<readonly [KerningSide, KerningSide] | null> = [
      [firstGlyph, secondGlyph],
      secondGroup && [firstGlyph, secondGroup],
      firstGroup && [firstGroup, secondGlyph],
      firstGroup && secondGroup && [firstGroup, secondGroup],
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const amount = values.get(pairKey(candidate[0], candidate[1]));
      if (amount !== undefined) return { first: candidate[0], second: candidate[1], amount };
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
}

function pairKey(first: KerningSide, second: KerningSide): string {
  return `${sideKey(first)}\u0000${sideKey(second)}`;
}

function sideKey(side: KerningSide): string {
  return side.kind === "glyph" ? `g:${side.id}` : `@:${side.id}`;
}
