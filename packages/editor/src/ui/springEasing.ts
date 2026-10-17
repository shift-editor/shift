/** A spring described the way designers tune one: how long it takes to look settled, and how much it overshoots. */
export interface Spring {
  /** Seconds until the spring looks settled, ignoring the tail of any bounce. */
  visualDuration: number;
  /** 0 for no overshoot; higher values bounce more. */
  bounce: number;
}

/** A spring baked into CSS: a `linear()` easing and the duration it runs for. */
export interface SpringEasing {
  /** CSS `linear()` easing that traces the spring's progress from 0 to 1. */
  easing: string;
  /** Milliseconds until the spring has come to rest, including any bounce. */
  duration: number;
  /**
   * Fraction of `duration`, from 0 to 1, at which the spring first reaches
   * `progress` of its way from 0 to 1. Lets other animations be pinned to where
   * the motion is rather than to the clock, since a spring covers most of its
   * distance early.
   */
  timeAtProgress: (progress: number) => number;
}

const STEP_SECONDS = 1 / 240;
const STEPS_PER_SAMPLE = 4;
const REST_DISTANCE = 0.0005;
const REST_SPEED = 0.01;
const MAX_SECONDS = 4;

/**
 * Bakes a spring into a CSS easing, so CSS transitions and the Web Animations
 * API can run it off the main thread without an animation library.
 *
 * @remarks
 * Stiffness and damping follow Motion's mapping from `visualDuration` and
 * `bounce`, so values tuned there carry over. The spring is simulated from 0 to
 * 1 and sampled at 60 points per second until it comes to rest.
 */
export function springEasing({ visualDuration, bounce }: Spring): SpringEasing {
  const angularFrequency = (2 * Math.PI) / (visualDuration * 1.2);
  const stiffness = angularFrequency * angularFrequency;
  const dampingRatio = Math.min(1, Math.max(0.05, 1 - bounce));
  const damping = 2 * dampingRatio * angularFrequency;

  const samples = [0];
  let position = 0;
  let velocity = 0;
  let step = 0;
  while (step * STEP_SECONDS < MAX_SECONDS) {
    velocity += (stiffness * (1 - position) - damping * velocity) * STEP_SECONDS;
    position += velocity * STEP_SECONDS;
    step += 1;
    const resting = Math.abs(1 - position) < REST_DISTANCE && Math.abs(velocity) < REST_SPEED;
    if (resting) break;
    if (step % STEPS_PER_SAMPLE === 0) samples.push(position);
  }
  samples.push(1);

  const timeAtProgress = (progress: number) => {
    const reached = samples.findIndex((sample) => sample >= progress);
    if (reached <= 0) return 0;

    const before = samples[reached - 1];
    const span = samples[reached] - before;
    const within = span > 0 ? (progress - before) / span : 0;

    return (reached - 1 + within) / (samples.length - 1);
  };

  return {
    timeAtProgress,
    easing: `linear(${samples.map((sample) => Number(sample.toFixed(4))).join(", ")})`,
    duration: Math.round(step * STEP_SECONDS * 1000),
  };
}
