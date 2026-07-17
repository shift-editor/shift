import type { Axis, Location, Source } from "@shift/types";
import type { AxisLocation, SourceCreationIssue } from "@/types/variation";
import { axisLocationFromLocation, axisLocationsEqual, axisValue } from "@/lib/variation/location";

const LOCATION_TOLERANCE = 1e-6;

/**
 * Parses editable axis fields into a complete persisted source location.
 *
 * @param axes - axes required in the persisted location.
 * @param values - external coordinate strings keyed by axis identity.
 * @returns a complete location, or null when any coordinate is empty or non-finite.
 */
export function sourceLocation(
  axes: readonly Axis[],
  values: Readonly<Record<string, string>>,
): Location | null {
  const entries = axes.map((axis) => {
    const input = values[axis.id];
    const value = input?.trim() ? Number(input) : Number.NaN;
    return [axis.id, value] as const;
  });
  if (entries.some(([, value]) => !Number.isFinite(value))) return null;

  return { values: Object.fromEntries(entries) } as Location;
}

/**
 * Returns the first authoring constraint that prevents source creation.
 *
 * @param name - proposed source name before whitespace is trimmed.
 * @param values - editable external coordinates keyed by axis identity.
 * @param axes - axes that define a complete source location.
 * @param sources - existing authored sources checked for name and location conflicts.
 * @returns an issue targeted at the responsible control or constraint; null when creation is valid.
 */
export function sourceCreationIssue(
  name: string,
  values: Readonly<Record<string, string>>,
  axes: readonly Axis[],
  sources: readonly Source[],
): SourceCreationIssue | null {
  const trimmedName = name.trim();
  if (!trimmedName) return { kind: "name", message: "Enter a source name" };
  if (sources.some((source) => source.name === trimmedName)) {
    return { kind: "name", message: `A source named “${trimmedName}” already exists` };
  }

  const invalidAxis = axes.find((axis) => {
    const input = values[axis.id];
    return !input?.trim() || !Number.isFinite(Number(input));
  });
  if (invalidAxis) {
    return {
      kind: "axis",
      axisId: invalidAxis.id,
      message: `Enter a number for ${invalidAxis.name}`,
    };
  }

  const location = {
    values: Object.fromEntries(axes.map((axis) => [axis.id, Number(values[axis.id])])),
  } as Location;

  const target = axisLocationFromLocation(location);
  const existing = sources.find((source) =>
    axisLocationsEqual(axisLocationFromLocation(source.location), target, axes, LOCATION_TOLERANCE),
  );
  return existing
    ? {
        kind: "location",
        sourceId: existing.id,
        message: `${existing.name} already exists at this location`,
      }
    : null;
}

/**
 * Suggests a unique source name from exact or ranged axis labels at a location.
 *
 * @param axes - axes whose labels contribute to the suggestion.
 * @param sources - existing sources whose names must not be reused.
 * @param location - external coordinates used to resolve applicable labels.
 * @returns a source name unique among the provided sources.
 */
export function suggestedSourceName(
  axes: readonly Axis[],
  sources: readonly Source[],
  location: AxisLocation,
): string {
  const labels = axes.flatMap((axis) => {
    const value = axisValue(location, axis);
    const exact = axis.labels.find(
      ({ minimum, maximum, value: nominal }) =>
        minimum === undefined &&
        maximum === undefined &&
        Math.abs(nominal - value) <= LOCATION_TOLERANCE,
    );
    if (exact) return [exact.name];

    const range = axis.labels.find(
      (label) =>
        label.minimum !== undefined &&
        label.maximum !== undefined &&
        value >= label.minimum - LOCATION_TOLERANCE &&
        value <= label.maximum + LOCATION_TOLERANCE,
    );
    return range ? [range.name] : [];
  });
  const base = labels.join(" ").trim() || `Source ${sources.length + 1}`;
  if (!sources.some((source) => source.name === base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!sources.some((source) => source.name === candidate)) return candidate;
  }
}
