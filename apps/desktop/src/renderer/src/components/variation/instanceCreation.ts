import type { Axis, Location, NamedInstance } from "@shift/types";
import type { InstanceCreationIssue } from "@shift/editor/types";
import { continuousBounds, discreteValues } from "@shift/editor/variation";
import { LocationDraft, type LocationDraftValues } from "./locationDraft";

/** Parses editable external-axis fields into a complete named-instance location. */
export function instanceLocation(
  axes: readonly Axis[],
  values: LocationDraftValues["location"],
): Location | null {
  const coordinates = new LocationDraft({ name: "", location: values }).coordinates(axes);
  return coordinates ? { values: coordinates } : null;
}

/** Returns the first authoring constraint that prevents named-instance creation. */
export function instanceCreationIssue(
  name: string,
  values: LocationDraftValues["location"],
  axes: readonly Axis[],
  instances: readonly NamedInstance[],
): InstanceCreationIssue | null {
  const draft = new LocationDraft({ name, location: values });
  const nameIssue = draft.nameIssue("an instance", instances);
  if (nameIssue) return nameIssue;

  for (const axis of axes) {
    const value = draft.coordinate(axis);
    const bounds = continuousBounds(axis);
    if (!Number.isFinite(value)) {
      return {
        kind: "axis",
        axisId: axis.id,
        message: `Enter a number for ${axis.name}`,
      };
    }

    if (axis.kind.kind === "discrete" && !discreteValues(axis)?.includes(value)) {
      return {
        kind: "axis",
        axisId: axis.id,
        message: `Choose a defined value for ${axis.name}`,
      };
    }
    if (bounds && value < bounds.minimum) {
      return {
        kind: "axis",
        axisId: axis.id,
        message: `${axis.name} must be at least ${bounds.minimum}`,
      };
    }
    if (bounds && value > bounds.maximum) {
      return {
        kind: "axis",
        axisId: axis.id,
        message: `${axis.name} must be at most ${bounds.maximum}`,
      };
    }
  }

  const coordinates = draft.coordinates(axes);
  if (!coordinates) return null;

  const location: Location = { values: coordinates };
  const existing = instances.find((instance) => sameLocation(instance.location, location, axes));
  return existing
    ? {
        kind: "location",
        instanceId: existing.id,
        message: `${existing.name} already exists at this location`,
      }
    : null;
}

/** Suggests the first unused numbered name for a new explicit instance. */
export function suggestedInstanceName(instances: readonly NamedInstance[]): string {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `Instance ${suffix}`;
    if (!instances.some((instance) => instance.name === candidate)) return candidate;
  }
}

function sameLocation(left: Location, right: Location, axes: readonly Axis[]): boolean {
  return axes.every((axis) => left.values[axis.id] === right.values[axis.id]);
}
