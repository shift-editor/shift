export type NudgeMagnitude = 'small' | 'medium' | 'large';
export const NUDGES_VALUES: Record<NudgeMagnitude, number> = {
  small: 1,
  medium: 10,
  large: 100,
} as const;
