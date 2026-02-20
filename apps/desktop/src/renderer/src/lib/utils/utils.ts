/** Whether the app is running in development mode. Guards debug-only UI and logging. */
export const isDev = process.env.NODE_ENV === "development";

/** Constrain `value` to the inclusive range [`min`, `max`]. */
export const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};
