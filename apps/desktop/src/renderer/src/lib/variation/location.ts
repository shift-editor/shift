import { asAxisId, type Axis, type AxisMapping, type Location } from "@shift/types";
import { mapAxisMappings } from "./mapping";
import type { AxisLocation } from "@/types/variation";

export function emptyAxisLocation(): AxisLocation {
  return new Map();
}

export function cloneAxisLocation(location: AxisLocation): AxisLocation {
  return new Map(location);
}

export function axisLocationFromRecord(values: Readonly<Record<string, number>>): AxisLocation {
  return new Map(Object.entries(values).map(([axisId, value]) => [asAxisId(axisId), value]));
}

export function axisLocationFromLocation(location: Location): AxisLocation {
  return axisLocationFromRecord(location.values);
}

export function locationFromAxisLocation(location: AxisLocation): Location {
  return { values: Object.fromEntries(location) };
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

/** Maps external coordinates through independent one-axis font mappings. */
export function mapAxisLocation(
  location: AxisLocation,
  axes: readonly Axis[],
  mappings: readonly AxisMapping[],
): AxisLocation {
  return mapAxisMappings(location, axes, mappings);
}

/** Evaluates a Designspace scalar mapping with offset extrapolation. */
export function mapAxisValue(
  value: number,
  points: readonly (readonly [number, number])[],
): number {
  const sorted = [...points].sort((left, right) => left[0] - right[0]);
  const first = sorted[0];
  if (!first) return value;
  if (value <= first[0]) return value + first[1] - first[0];

  for (let index = 1; index < sorted.length; index++) {
    const lower = sorted[index - 1];
    const upper = sorted[index];
    if (!lower || !upper || value > upper[0]) continue;
    if (lower[0] === upper[0]) return lower[1];

    return lower[1] + ((upper[1] - lower[1]) * (value - lower[0])) / (upper[0] - lower[0]);
  }

  const last = sorted[sorted.length - 1];
  return last ? value + last[1] - last[0] : value;
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
