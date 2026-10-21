import type { CaretStop, Direction, Line } from "./types";
import type { PlacedGlyph } from "./TextLayout";

/**
 * Where a caret can stand on one line of a layout, and how it moves there.
 *
 * @remarks
 * Built once with the layout. Every cluster on the line has a position; only
 * grapheme boundaries are stops a caret rests at, kept in screen order (left
 * to right, ties in reading order, as zero-width glyphs share an x) so moves
 * and hit tests never sort.
 */
export class LineCarets {
  readonly #xByCluster: ReadonlyMap<number, number>;
  /** Stops a caret may rest at, left to right on screen. */
  readonly #onScreen: readonly CaretStop[];

  /**
   * @param placed - the line's placed glyphs.
   * @param boundaries - clusters a caret may rest at.
   */
  constructor(line: Line, placed: readonly PlacedGlyph[], boundaries: ReadonlySet<number>) {
    const positions = clusterPositions(line, placed);
    this.#xByCluster = new Map(positions.map((stop) => [stop.cluster, stop.x]));
    this.#onScreen = positions
      .filter((stop) => boundaries.has(stop.cluster))
      .toSorted(onScreen(line.direction));
  }

  /** Returns where a caret at `cluster` draws, or null for a cluster not on the line. */
  positionOf(cluster: number): number | null {
    return this.#xByCluster.get(cluster) ?? null;
  }

  /**
   * Returns the stop nearest `x`.
   *
   * @param padding - how far past the line's ends still counts; omitted, any `x` does.
   * @returns null when the line has no stops or `x` is past its ends.
   */
  nearest(x: number, padding = Infinity): CaretStop | null {
    const left = this.#onScreen[0];
    const right = this.#onScreen.at(-1);
    if (!left || !right || x < left.x - padding || x > right.x + padding) return null;

    return this.#onScreen.reduce((best, stop) =>
      Math.abs(stop.x - x) < Math.abs(best.x - x) ? stop : best,
    );
  }

  /**
   * Returns the stop one character left (`-1`) or right (`1`) of `cluster` on
   * screen, passing over stops `accept` refuses.
   *
   * @returns null at the line's edge in that direction, or for a cluster that is not a stop.
   */
  step(cluster: number, side: -1 | 1, accept: (cluster: number) => boolean): number | null {
    const index = this.#onScreen.findIndex((stop) => stop.cluster === cluster);
    if (index < 0) return null;

    for (let next = index + side; next >= 0 && next < this.#onScreen.length; next += side) {
      const stop = this.#onScreen[next]!;
      if (accept(stop.cluster)) return stop.cluster;
    }
    return null;
  }

  /** Returns the stop at the line's left (`-1`) or right (`1`) end on screen. */
  edge(side: -1 | 1): number | null {
    const stop = side === -1 ? this.#onScreen[0] : this.#onScreen.at(-1);
    return stop?.cluster ?? null;
  }
}

/**
 * Returns the x of the boundary `k` items into a glyph covering `count`
 * items, measured from its leading edge.
 *
 * @remarks
 * Kerning after the glyph belongs to its box, so a kerned pair leaves no gap
 * between stops. A ligature splits its width evenly between its items.
 */
export function glyphEdge(
  placed: PlacedGlyph,
  direction: Direction,
  k: number,
  count: number,
): number {
  const width = placed.glyph.xAdvance + placed.glyph.xKern;
  const offset = (width * k) / count;
  return direction === "rtl" ? placed.left + width - offset : placed.left + offset;
}

/** Orders stops left to right on screen; stops at one x follow the line's reading order. */
function onScreen(direction: Direction): (a: CaretStop, b: CaretStop) => number {
  const reading = direction === "rtl" ? -1 : 1;
  return (a, b) => a.x - b.x || (a.cluster - b.cluster) * reading;
}

/**
 * Returns a position for every cluster on a line, in cluster order.
 *
 * @remarks
 * Each glyph with an advance gives its items positions across its box: the
 * first item at the leading edge, a ligature's later items at even splits,
 * and the cluster after its last item at the trailing edge. A glyph's
 * leading edge wins over its neighbour's trailing edge. Clusters held only
 * by zero-advance glyphs (an unattached mark) stand at the glyph; anything
 * left, such as an empty line's end, stands at the line's end.
 */
function clusterPositions(line: Line, placed: readonly PlacedGlyph[]): CaretStop[] {
  const xs = new Map<number, number>();
  const claim = (cluster: number, x: number) => {
    if (!xs.has(cluster)) xs.set(cluster, x);
  };
  const spacing = placed.filter((glyph) => glyph.glyph.xAdvance > 0);
  const directionOf = (glyph: PlacedGlyph) => line.runs[glyph.runIndex]!.direction;

  for (const glyph of spacing) {
    const count = glyph.glyph.sourceItemIds.length;
    for (let k = 0; k < count; k++) {
      claim(glyph.glyph.cluster + k, glyphEdge(glyph, directionOf(glyph), k, count));
    }
  }
  for (const glyph of spacing) {
    const count = glyph.glyph.sourceItemIds.length;
    claim(glyph.glyph.cluster + count, glyphEdge(glyph, directionOf(glyph), count, count));
  }
  for (const glyph of placed) claim(glyph.glyph.cluster, glyph.left);

  const advance = line.runs.reduce((sum, run) => sum + run.advance, 0);
  const lineEnd = line.direction === "rtl" ? line.x : line.x + advance;
  const positions: CaretStop[] = [];
  for (let cluster = line.clusterStart; cluster < line.clusterEnd; cluster++) {
    positions.push({ cluster, x: xs.get(cluster) ?? lineEnd });
  }
  return positions;
}
