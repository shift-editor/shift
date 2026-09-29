export type NudgeMagnitude = "small" | "medium" | "large";

/** Nudge size for the held modifiers: accel (Cmd/Ctrl) is large, Shift is medium. */
export function nudgeMagnitude(modifiers: { accel: boolean; shift: boolean }): NudgeMagnitude {
  if (modifiers.accel) return "large";
  if (modifiers.shift) return "medium";
  return "small";
}
export const NUDGES_VALUES: Record<NudgeMagnitude, number> = {
  small: 1,
  medium: 10,
  large: 100,
} as const;
