import { asAxisId, type Axis, type AxisId, type Location } from "@shift/types";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";

type AnyAxisLocation = ExternalAxisLocation | DesignAxisLocation;

/**
 * Marks axis values as a user-space location.
 *
 * @remarks
 * The one place a plain map becomes an `ExternalAxisLocation`, like
 * `asPointId` for ids; the brand only records which space the values are in.
 */
export function asExternalAxisLocation(values: ReadonlyMap<AxisId, number>): ExternalAxisLocation {
  return values as ExternalAxisLocation;
}

/** Marks axis values as a design-space location; see {@link asExternalAxisLocation}. */
export function asDesignAxisLocation(values: ReadonlyMap<AxisId, number>): DesignAxisLocation {
  return values as DesignAxisLocation;
}

export function emptyExternalAxisLocation(): ExternalAxisLocation {
  return asExternalAxisLocation(new Map());
}

export function cloneExternalAxisLocation(location: ExternalAxisLocation): ExternalAxisLocation {
  return asExternalAxisLocation(new Map(location));
}

/**
 * Builds a user-space axis location from plain `{ axisId: value }` pairs.
 *
 * @param values - Axis values keyed by axis id; axes left out take their default.
 * @returns A new location the caller owns; the input record is not retained.
 */
export function externalAxisLocationFromRecord(
  values: Readonly<Record<string, number>>,
): ExternalAxisLocation {
  return asExternalAxisLocation(
    new Map(Object.entries(values).map(([axisId, value]) => [asAxisId(axisId), value])),
  );
}

export function externalAxisLocationFromLocation(location: Location): ExternalAxisLocation {
  return externalAxisLocationFromRecord(location.values);
}

export function designAxisLocationFromLocation(location: Location): DesignAxisLocation {
  return asDesignAxisLocation(
    new Map(Object.entries(location.values).map(([axisId, value]) => [asAxisId(axisId), value])),
  );
}

export function locationFromExternalAxisLocation(location: ExternalAxisLocation): Location {
  return { values: Object.fromEntries(location) };
}

export function locationFromDesignAxisLocation(location: DesignAxisLocation): Location {
  return { values: Object.fromEntries(location) };
}

export function defaultExternalAxisLocation(axes: readonly Axis[]): ExternalAxisLocation {
  return asExternalAxisLocation(new Map(axes.map((axis) => [axis.id, axis.default])));
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
  return asExternalAxisLocation(next);
}

/** Whether two user-space locations name the same value on exactly the same axes. */
export function externalAxisLocationsEqual(
  left: ExternalAxisLocation,
  right: ExternalAxisLocation,
): boolean {
  if (left.size !== right.size) return false;

  for (const [axisId, value] of left) {
    if (right.get(axisId) !== value) return false;
  }
  return true;
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
