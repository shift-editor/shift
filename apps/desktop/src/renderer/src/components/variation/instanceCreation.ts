import type { Axis, Location, NamedInstance } from "@shift/types";
import type { InstanceCreationIssue } from "@/types/variation";

/** Parses editable external-axis fields into a complete named-instance location. */
export function instanceLocation(
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

/** Returns the first authoring constraint that prevents named-instance creation. */
export function instanceCreationIssue(
  name: string,
  values: Readonly<Record<string, string>>,
  axes: readonly Axis[],
  instances: readonly NamedInstance[],
): InstanceCreationIssue | null {
  const trimmedName = name.trim();
  if (!trimmedName) return { kind: "name", message: "Enter an instance name" };
  if (instances.some((instance) => instance.name === trimmedName)) {
    return {
      kind: "name",
      message: `An instance named “${trimmedName}” already exists`,
    };
  }

  for (const axis of axes) {
    const input = values[axis.id];
    const value = input?.trim() ? Number(input) : Number.NaN;
    if (!Number.isFinite(value)) {
      return {
        kind: "axis",
        axisId: axis.id,
        message: `Enter a number for ${axis.name}`,
      };
    }

    if (axis.axisType === "discrete" && !axis.values?.includes(value)) {
      return {
        kind: "axis",
        axisId: axis.id,
        message: `Choose a defined value for ${axis.name}`,
      };
    }
    if (axis.minimum !== undefined && value < axis.minimum) {
      return {
        kind: "axis",
        axisId: axis.id,
        message: `${axis.name} must be at least ${axis.minimum}`,
      };
    }
    if (axis.maximum !== undefined && value > axis.maximum) {
      return {
        kind: "axis",
        axisId: axis.id,
        message: `${axis.name} must be at most ${axis.maximum}`,
      };
    }
  }

  const location = instanceLocation(axes, values);
  if (!location) return null;

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
