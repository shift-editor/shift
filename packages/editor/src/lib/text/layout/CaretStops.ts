import { EntityMap, type ReadonlyEntityMap } from "@shift/types";
import type { CaretStop } from "@shift/wasm/protocol";

/**
 * An index over one line's caret stops, for moves and hit tests.
 *
 * @remarks
 * Rust's layout computes every stop and where it draws: the leading edge of
 * right-to-left text, the second edge where directions meet, and the carets
 * inside a ligature, and their order on screen (`screen`). This only finds
 * the stops by unit, by x, and by their neighbours on screen, so arrow keys
 * follow the screen.
 */
export class CaretStops {
  /** The line's stops, left to right on screen. */
  readonly #onScreen: readonly CaretStop[];
  readonly #byUnit: ReadonlyEntityMap<number, CaretStop>;

  /** @param stops - one line's stops, as the layout returns them. */
  constructor(stops: readonly CaretStop[]) {
    this.#byUnit = new EntityMap(
      "caret stop",
      stops.map((stop) => [stop.unit, stop] as const),
    );
    const onScreen: CaretStop[] = [];
    for (const stop of stops) onScreen[stop.screen] = stop;
    this.#onScreen = onScreen;
  }

  /** Returns the stop at `unit`, or null for a unit that is not a boundary on the line. */
  at(unit: number): CaretStop | null {
    return this.#byUnit.get(unit);
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
   * Returns the unit of the next stop left (`-1`) or right (`1`) of `unit` on
   * screen that `accept` takes.
   *
   * @returns null at the line's edge in that direction, or for a unit that is not a stop.
   */
  step(unit: number, side: -1 | 1, accept: (unit: number) => boolean = () => true): number | null {
    const index = this.#onScreen.findIndex((stop) => stop.unit === unit);
    if (index < 0) return null;

    for (let next = index + side; next >= 0 && next < this.#onScreen.length; next += side) {
      const stop = this.#onScreen[next]!;
      if (accept(stop.unit)) return stop.unit;
    }
    return null;
  }

  /** Returns the unit at the line's left (`-1`) or right (`1`) end on screen. */
  edge(side: -1 | 1): number | null {
    const stop = side === -1 ? this.#onScreen[0] : this.#onScreen.at(-1);
    return stop?.unit ?? null;
  }
}
