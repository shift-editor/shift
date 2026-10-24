import type { Axis, Source } from "@shift/types";
import type { ExternalAxisLocation, SourceCreationIssue } from "@shift/editor/types";
import {
  axisValue,
  designAxisLocationFromLocation,
  designAxisLocationsEqual,
  externalAxisLocationFromRecord,
  type Designspace,
} from "@shift/editor/variation";
import { LocationDraft, type LocationDraftValues } from "./locationDraft";

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
  values: LocationDraftValues["location"],
): ExternalAxisLocation | null {
  const coordinates = new LocationDraft({ name: "", location: values }).coordinates(axes);
  return coordinates ? externalAxisLocationFromRecord(coordinates) : null;
}

/**
 * Returns the first authoring constraint that prevents source creation.
 *
 * @param name - proposed source name before whitespace is trimmed.
 * @param values - editable external coordinates keyed by axis identity.
 * @param designspace - axes that define a complete source location, and the existing sources
 *   checked for name and location conflicts.
 * @returns an issue targeted at the responsible control or constraint; null when creation is valid.
 */
export function sourceCreationIssue(
  name: string,
  values: LocationDraftValues["location"],
  designspace: Designspace,
): SourceCreationIssue | null {
  const { axes, sources } = designspace;
  const draft = new LocationDraft({ name, location: values });
  const nameIssue = draft.nameIssue("a source", sources);
  if (nameIssue) return nameIssue;

  const invalidAxis = draft.invalidAxis(axes);
  if (invalidAxis) {
    return {
      kind: "axis",
      axisId: invalidAxis.id,
      message: `Enter a number for ${invalidAxis.name}`,
    };
  }

  const coordinates = draft.coordinates(axes);
  if (!coordinates) return null;

  const target = designspace.toDesign(externalAxisLocationFromRecord(coordinates));
  const existing = sources.find((source) =>
    designAxisLocationsEqual(
      designAxisLocationFromLocation(source.location),
      target,
      axes,
      LOCATION_TOLERANCE,
    ),
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
  location: ExternalAxisLocation,
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
