import { asAxisId, type Axis, type Location } from "@shift/types";
import type { AxisLocation } from "@/types/variation";

export function emptyAxisLocation(): AxisLocation {
  return new Map();
}

export function axisLocationFromRecord(values: Readonly<Record<string, number>>): AxisLocation {
  return new Map(Object.entries(values).map(([axisId, value]) => [asAxisId(axisId), value]));
}

export function axisLocationFromLocation(location: Location): AxisLocation {
  return axisLocationFromRecord(location.values);
}

export function defaultAxisLocation(axes: readonly Axis[]): AxisLocation {
  return new Map(axes.map((axis) => [axis.id, axis.default]));
}

export function axisValue(location: AxisLocation, axis: Axis): number {
  return location.get(axis.id) ?? axis.default;
}

export function withAxisValue(location: AxisLocation, axis: Axis, value: number): AxisLocation {
  const next = new Map(location);
  next.set(axis.id, value);
  return next;
}

export function axisLocationsEqual(
  left: AxisLocation,
  right: AxisLocation,
  axes: readonly Axis[],
  tolerance = 1e-6,
): boolean {
  return axes.every(
    (axis) => Math.abs(axisValue(left, axis) - axisValue(right, axis)) <= tolerance,
  );
}

export function axisLocationDistanceSquared(
  left: AxisLocation,
  right: AxisLocation,
  axes: readonly Axis[],
): number {
  let total = 0;
  for (const axis of axes) {
    const delta = axisValue(left, axis) - axisValue(right, axis);
    total += delta * delta;
  }
  return total;
}
