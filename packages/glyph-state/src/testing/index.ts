/**
 * Signed difference between two angles in degrees, in [-180, 180).
 *
 * Compare decomposed rotations with this rather than subtracting them: 180°
 * and -180° are the same rotation, and a flip lands on either depending on the
 * sign of a zero in its matrix. JSON imports drop that sign, so a Rust
 * reference can report -180° where the TypeScript copy reports 180°.
 */
export function angleBetween(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}
