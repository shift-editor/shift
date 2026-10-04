import type { WheelGestureAction, WheelGestureSample } from "../../types/transform";

/** Quiet period that ends a modifier zoom gesture. */
export const WHEEL_GESTURE_IDLE_MS = 120;

/**
 * Keeps trackpad zoom momentum from turning into pan after the modifier is released.
 *
 * @remarks
 * A modifier wheel sample starts or extends a zoom gesture. An unmodified sample is momentum,
 * and extends the gesture without panning, only while it arrives within
 * {@link WHEEL_GESTURE_IDLE_MS} of the previous gesture sample and is no larger than it:
 * momentum decays, so a growing sample is a new pan. Without the size check, a pan started
 * right after a zoom kept renewing the window and never moved the view. Classification uses
 * event timestamps rather than timers, so the result depends only on the sample sequence.
 */
export class WheelGesture {
  #lastGestureTime: number | null = null;
  #lastGestureMagnitude = 0;

  constructor(readonly idleMs = WHEEL_GESTURE_IDLE_MS) {}

  /**
   * Classifies one wheel sample and advances the gesture.
   * @param sample - Wheel sample in arrival order.
   * @returns how the viewport should respond to the sample.
   */
  classify(sample: WheelGestureSample): WheelGestureAction {
    if (sample.zoomModifier) {
      this.#lastGestureTime = sample.timeStamp;
      this.#lastGestureMagnitude = sample.magnitude;
      return "zoom";
    }

    const withinGesture =
      this.#lastGestureTime !== null && sample.timeStamp - this.#lastGestureTime < this.idleMs;
    const decaying = sample.magnitude <= this.#lastGestureMagnitude;
    if (withinGesture && decaying) {
      this.#lastGestureTime = sample.timeStamp;
      this.#lastGestureMagnitude = sample.magnitude;
      return "ignore";
    }

    this.#lastGestureTime = null;
    return "pan";
  }
}
