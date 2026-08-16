import type { PositionCondition } from "@/types/positionEdit";

const HYSTERESIS_FACTOR = 0.6;

/** Quantizes scalar rotation angles while preserving the previous snap near boundaries. */
export class AngleSnap {
  readonly #increment: number;
  readonly #when: () => boolean;
  #previous: number | null = null;

  private constructor(increment: number, condition?: PositionCondition) {
    this.#increment = increment;
    this.#when = condition?.when ?? (() => true);
  }

  static everyDegrees(degrees: number, condition?: PositionCondition): AngleSnap {
    if (!Number.isFinite(degrees) || degrees <= 0) {
      throw new Error("Angle snap increment must be a positive finite number");
    }

    return new AngleSnap((degrees * Math.PI) / 180, condition);
  }

  apply(angle: number): number | null {
    if (!this.#when()) {
      this.#previous = null;
      return null;
    }

    if (this.#previous !== null) {
      const difference = Math.atan2(
        Math.sin(angle - this.#previous),
        Math.cos(angle - this.#previous),
      );
      if (Math.abs(difference) <= this.#increment * HYSTERESIS_FACTOR) {
        return this.#previous;
      }
    }

    const snapped = Math.round(angle / this.#increment) * this.#increment;
    this.#previous = snapped;
    return snapped;
  }
}
