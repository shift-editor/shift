/** The point before `index`, wrapping to the last point on a closed contour. */
export function previousPoint<P>(points: readonly P[], index: number, closed: boolean): P | null {
  if (index > 0) return points[index - 1] ?? null;
  if (!closed) return null;
  return points[points.length - 1] ?? null;
}

/** The point after `index`, wrapping to the first point on a closed contour. */
export function nextPoint<P>(points: readonly P[], index: number, closed: boolean): P | null {
  if (index + 1 < points.length) return points[index + 1] ?? null;
  if (!closed) return null;
  return points[0] ?? null;
}
