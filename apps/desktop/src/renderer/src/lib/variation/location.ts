import { asAxisId, type Axis, type AxisMapping, type Location } from "@shift/types";
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
  const mapped = new Map(
    axes.map((axis) => [
      axis.id,
      axis.role === "external" ? axisValue(location, axis) : axis.default,
    ]),
  );
  const axesById = new Map(axes.map((axis) => [axis.id, axis]));

  for (const mapping of mappings) {
    const [inputAxisId] = mapping.inputs;
    const [outputAxisId] = mapping.outputs;
    if (
      mapping.inputs.length !== 1 ||
      mapping.outputs.length !== 1 ||
      inputAxisId !== outputAxisId ||
      !inputAxisId
    ) {
      continue;
    }

    const axis = axesById.get(inputAxisId);
    if (!axis) continue;
    const points = mapping.points.map((point) => {
      const input = point.input.values[inputAxisId] ?? axis.default;
      return [input, point.output.values[outputAxisId] ?? input] as const;
    });
    mapped.set(outputAxisId, mapAxisValue(axisValue(location, axis), points));
  }

  return mapped;
}

/** Evaluates one scalar piecewise-linear mapping, including endpoint extrapolation. */
export function mapAxisValue(
  value: number,
  points: readonly (readonly [number, number])[],
): number {
  if (points.length === 0) return value;
  if (points.length === 1) return points[0]?.[1] ?? value;

  const sorted = [...points].sort((left, right) => left[0] - right[0]);
  let lower = sorted[0];
  let upper = sorted[1];
  if (value >= (sorted[sorted.length - 1]?.[0] ?? value)) {
    lower = sorted[sorted.length - 2];
    upper = sorted[sorted.length - 1];
  } else if (value > (sorted[0]?.[0] ?? value)) {
    const upperIndex = sorted.findIndex((point) => point[0] >= value);
    lower = sorted[upperIndex - 1];
    upper = sorted[upperIndex];
  }
  if (!lower || !upper) return value;
  if (lower[0] === upper[0]) return lower[1];

  return lower[1] + ((upper[1] - lower[1]) * (value - lower[0])) / (upper[0] - lower[0]);
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
