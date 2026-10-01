import type { WheelGestureAction, WheelGestureSample } from "../../types/transform";

/** Quiet period that ends a modifier zoom gesture. */
export const WHEEL_GESTURE_IDLE_MS = 120;

/**
 * Keeps trackpad zoom momentum from turning into pan after the modifier is released.
 *
 * @remarks
 * A modifier wheel sample starts or extends a zoom gesture. Unmodified samples that arrive
 * within {@link WHEEL_GESTURE_IDLE_MS} of the previous gesture sample are momentum and
 * extend the gesture without panning. Classification uses event timestamps rather than
 * timers, so the result depends only on the sample sequence.
 */
export class WheelGesture {
  #lastGestureTime: number | null = null;

  constructor(readonly idleMs = WHEEL_GESTURE_IDLE_MS) {}

  /**
   * Classifies one wheel sample and advances the gesture.
   * @param sample - Wheel sample in arrival order.
   * @returns how the viewport should respond to the sample.
   */
  classify(sample: WheelGestureSample): WheelGestureAction {
    if (sample.zoomModifier) {
      this.#lastGestureTime = sample.timeStamp;
      return "zoom";
    }

    if (this.#lastGestureTime !== null && sample.timeStamp - this.#lastGestureTime < this.idleMs) {
      this.#lastGestureTime = sample.timeStamp;
      return "ignore";
    }

    this.#lastGestureTime = null;
    return "pan";
  }
}
