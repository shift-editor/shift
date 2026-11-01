import { EntityMap, type ReadonlyEntityMap } from "@shift/types";
import type { CaretStop } from "@shift/wasm/protocol";
import type { CaretEdge, CaretPlace } from "./types";

/**
 * An index over one line's caret stops, for moves and hit tests.
 *
 * @remarks
 * Rust's layout computes every stop and where it draws: the leading edge of
 * right-to-left text, the second edge where directions meet, and the carets
 * inside a ligature, and the order on screen of every place a caret can
 * show (each stop's `screen`, and its second place's at a direction
 * boundary). This only finds the stops by unit, by x, and the places by
 * their neighbours on screen, so arrow keys follow the screen.
 */
export class CaretStops {
  /** The line's caret places, left to right on screen. */
  readonly #onScreen: readonly CaretPlace[];
  /** The line's stops, left to right on screen by their own place. */
  readonly #stopsOnScreen: readonly CaretStop[];
  readonly #byUnit: ReadonlyEntityMap<number, CaretStop>;

  /** @param stops - one line's stops, as the layout returns them. */
  constructor(stops: readonly CaretStop[]) {
    this.#byUnit = new EntityMap(
      "caret stop",
      stops.map((stop) => [stop.unit, stop] as const),
    );
    const onScreen: CaretPlace[] = [];
    for (const stop of stops) {
      const { unit, x, direction, secondary } = stop;
      onScreen[stop.screen] = { unit, edge: "primary", x, direction };
      if (secondary) {
        onScreen[secondary.screen] = { unit, edge: "secondary", ...secondary };
      }
    }
    this.#onScreen = onScreen;
    this.#stopsOnScreen = onScreen
      .filter((place) => place.edge === "primary")
      .map((place) => this.#byUnit.require(place.unit));
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
    const left = this.#stopsOnScreen[0];
    const right = this.#stopsOnScreen.at(-1);
    if (!left || !right || x < left.x - padding || x > right.x + padding) return null;

    return this.#stopsOnScreen.reduce((best, stop) =>
      Math.abs(stop.x - x) < Math.abs(best.x - x) ? stop : best,
    );
  }

  /**
   * Returns the next caret place left (`-1`) or right (`1`) on screen of the
   * one the caret stands at, `unit` at its `edge` place, that `accept` takes.
   *
   * @returns null at the line's edge in that direction, or for a unit that is not a stop.
   */
  step(
    unit: number,
    edge: CaretEdge,
    side: -1 | 1,
    accept: (place: CaretPlace) => boolean = () => true,
  ): CaretPlace | null {
    const index = this.#indexOf(unit, edge);
    if (index < 0) return null;

    for (let next = index + side; next >= 0 && next < this.#onScreen.length; next += side) {
      const place = this.#onScreen[next]!;
      if (accept(place)) return place;
    }
    return null;
  }

  /** Returns the caret place at the line's left (`-1`) or right (`1`) end on screen. */
  edge(side: -1 | 1): CaretPlace | null {
    return (side === -1 ? this.#onScreen[0] : this.#onScreen.at(-1)) ?? null;
  }

  /** Where `unit`'s `edge` place is on screen; its own place when it has no second one. */
  #indexOf(unit: number, edge: CaretEdge): number {
    const exact = this.#onScreen.findIndex((place) => place.unit === unit && place.edge === edge);
    if (exact >= 0) return exact;
    return this.#onScreen.findIndex((place) => place.unit === unit && place.edge === "primary");
  }
}
