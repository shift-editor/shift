import { asAxisId, type Axis, type AxisMappingBasis, type Location } from "@shift/types";
import type { DesignAxisLocation, ExternalAxisLocation } from "@/types/variation";
import { mapAxisMappings } from "./mapping";

type AnyAxisLocation = ExternalAxisLocation | DesignAxisLocation;

export function emptyExternalAxisLocation(): ExternalAxisLocation {
  return new Map() as unknown as ExternalAxisLocation;
}

export function cloneExternalAxisLocation(location: ExternalAxisLocation): ExternalAxisLocation {
  return new Map(location) as unknown as ExternalAxisLocation;
}

export function externalAxisLocationFromRecord(
  values: Readonly<Record<string, number>>,
): ExternalAxisLocation {
  return new Map(
    Object.entries(values).map(([axisId, value]) => [asAxisId(axisId), value]),
  ) as unknown as ExternalAxisLocation;
}

export function externalAxisLocationFromLocation(location: Location): ExternalAxisLocation {
  return externalAxisLocationFromRecord(location.values);
}

export function designAxisLocationFromLocation(location: Location): DesignAxisLocation {
  return new Map(
    Object.entries(location.values).map(([axisId, value]) => [asAxisId(axisId), value]),
  ) as unknown as DesignAxisLocation;
}

export function locationFromDesignAxisLocation(location: DesignAxisLocation): Location {
  return { values: Object.fromEntries(location) };
}

export function defaultExternalAxisLocation(axes: readonly Axis[]): ExternalAxisLocation {
  return new Map(axes.map((axis) => [axis.id, axis.default])) as unknown as ExternalAxisLocation;
}

export function axisValue(location: AnyAxisLocation, axis: Axis): number {
  return location.get(axis.id) ?? axis.default;
}

export function withExternalAxisValue(
  location: ExternalAxisLocation,
  axis: Axis,
  value: number,
): ExternalAxisLocation {
  const next = new Map(location);
  next.set(axis.id, value);
  return next as unknown as ExternalAxisLocation;
}

/** Maps external coordinates exactly once into internal design-space coordinates. */
export function mapAxisLocation(
  location: ExternalAxisLocation,
  axes: readonly Axis[],
  bases: readonly AxisMappingBasis[],
): DesignAxisLocation {
  return mapAxisMappings(location, axes, bases);
}

export function designAxisLocationsEqual(
  left: DesignAxisLocation,
  right: DesignAxisLocation,
  axes: readonly Axis[],
  tolerance = 1e-6,
): boolean {
  return axes.every(
    (axis) => Math.abs(axisValue(left, axis) - axisValue(right, axis)) <= tolerance,
  );
}

export function designAxisLocationDistanceSquared(
  left: DesignAxisLocation,
  right: DesignAxisLocation,
  axes: readonly Axis[],
): number {
  let total = 0;
  for (const axis of axes) {
    const delta = axisValue(left, axis) - axisValue(right, axis);
    total += delta * delta;
  }
  return total;
}
