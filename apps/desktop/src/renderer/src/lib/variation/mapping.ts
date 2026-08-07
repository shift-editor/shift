import type { Axis, AxisId, AxisMapping } from "@shift/types";
import { mappingAdjustments } from "./mappingModel";
import type { AxisLocation, AxisMappingSample } from "@/types/variation";

export function mapAxisMappings(
  location: AxisLocation,
  axes: readonly Axis[],
  mappings: readonly AxisMapping[],
): AxisLocation {
  const mapped = new Map(
    axes.map((axis) => [
      axis.id,
      axis.role === "external" ? axisLocationValue(location, axis) : axis.default,
    ]),
  );

  for (const mapping of mappings.filter(isIndependent)) {
    applyMapping(mapped, evaluateMapping(mapping, location, axes));
  }

  const independentlyMapped = new Map(mapped);
  for (const mapping of mappings.filter((mapping) => !isIndependent(mapping))) {
    applyMapping(mapped, evaluateMapping(mapping, independentlyMapped, axes));
  }

  return mapped;
}

function applyMapping(target: Map<AxisId, number>, output: AxisLocation): void {
  for (const [axisId, value] of output) target.set(axisId, value);
}

function isIndependent(mapping: AxisMapping): boolean {
  return (
    mapping.inputs.length === 1 &&
    mapping.outputs.length === 1 &&
    mapping.inputs[0] === mapping.outputs[0]
  );
}

function evaluateMapping(
  mapping: AxisMapping,
  location: AxisLocation,
  axes: readonly Axis[],
): AxisLocation {
  const axesById = new Map(axes.map((axis) => [axis.id, axis]));
  const inputAxes = mapping.inputs.map((axisId) => requiredAxis(axisId, axesById, mapping));
  const outputAxes = mapping.outputs.map((axisId) => requiredAxis(axisId, axesById, mapping));
  const samples = new Map<string, AxisMappingSample>();

  for (const point of mapping.points) {
    const normalized = normalizedLocation(point.input.values, inputAxes);
    const values = outputAxes.map((axis) => {
      const input = point.input.values[axis.id] ?? axis.default;
      const output = point.output.values[axis.id] ?? input;
      return normalizeAxis(output, axis) - normalizeAxis(input, axis);
    });
    const key = locationKey(normalized, inputAxes);
    if (samples.has(key)) {
      throw new Error(`axis mapping ${mapping.name} has duplicate point inputs`);
    }
    samples.set(key, { location: normalized, values });
  }

  const defaultLocation = new Map(inputAxes.map((axis) => [axis.id, 0]));
  const defaultKey = locationKey(defaultLocation, inputAxes);
  if (!samples.has(defaultKey)) {
    samples.set(defaultKey, {
      location: defaultLocation,
      values: outputAxes.map(() => 0),
    });
  }

  const target = normalizedLocation(location, inputAxes);
  const adjustments = mappingAdjustments([...samples.values()], target, inputAxes);
  return new Map(
    outputAxes.map((axis, index) => {
      const base = axisLocationValue(location, axis);
      return [
        axis.id,
        denormalizeAxis(normalizeAxis(base, axis) + (adjustments[index] ?? 0), axis),
      ];
    }),
  );
}

function requiredAxis(
  axisId: AxisId,
  axesById: ReadonlyMap<AxisId, Axis>,
  mapping: AxisMapping,
): Axis {
  const axis = axesById.get(axisId);
  if (!axis) throw new Error(`axis mapping ${mapping.name} references unknown axis ${axisId}`);
  return axis;
}

function normalizedLocation(
  location: AxisLocation | Readonly<Record<string, number>>,
  axes: readonly Axis[],
): AxisLocation {
  return new Map(
    axes.map((axis) => {
      const value = location instanceof Map ? location.get(axis.id) : location[axis.id];
      return [axis.id, normalizeAxis(value ?? axis.default, axis)];
    }),
  );
}

function locationKey(location: AxisLocation, axes: readonly Axis[]): string {
  return axes.map((axis) => location.get(axis.id) ?? 0).join(",");
}

function axisLocationValue(location: AxisLocation, axis: Axis): number {
  return location.get(axis.id) ?? axis.default;
}

function normalizeAxis(value: number, axis: Axis): number {
  const minimum = axis.minimum ?? Math.min(...(axis.values ?? [axis.default]));
  const maximum = axis.maximum ?? Math.max(...(axis.values ?? [axis.default]));
  if (value < axis.default) {
    const range = axis.default - minimum;
    return Math.abs(range) < Number.EPSILON ? 0 : (value - axis.default) / range;
  }
  if (value > axis.default) {
    const range = maximum - axis.default;
    return Math.abs(range) < Number.EPSILON ? 0 : (value - axis.default) / range;
  }
  return 0;
}

function denormalizeAxis(value: number, axis: Axis): number {
  const minimum = axis.minimum ?? Math.min(...(axis.values ?? [axis.default]));
  const maximum = axis.maximum ?? Math.max(...(axis.values ?? [axis.default]));
  if (value < 0) return axis.default + value * (axis.default - minimum);
  if (value > 0) return axis.default + value * (maximum - axis.default);
  return axis.default;
}
