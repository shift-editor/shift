import type { Axis, AxisMapping } from "@shift/types";

/**
 * The mapping that maps `axis` onto itself alone, or null when it has none.
 *
 * @remarks
 * An axis has at most one independent mapping; cross-axis mappings, with
 * several inputs or outputs, are not independent.
 */
export function independentMappingFor(
  mappings: readonly AxisMapping[],
  axis: Axis,
): AxisMapping | null {
  return mappings.find((mapping) => isIndependentMappingOf(mapping, axis)) ?? null;
}

/**
 * The mappings with `mapping` as `axis`'s independent mapping: it replaces the
 * mapping with the same id or the axis's current independent mapping, whichever
 * comes first, or is appended when there is neither.
 */
export function withIndependentMapping(
  mappings: readonly AxisMapping[],
  axis: Axis,
  mapping: AxisMapping,
): AxisMapping[] {
  const index = mappings.findIndex(
    (candidate) => candidate.id === mapping.id || isIndependentMappingOf(candidate, axis),
  );
  return index === -1 ? [...mappings, mapping] : mappings.with(index, mapping);
}

function isIndependentMappingOf(mapping: AxisMapping, axis: Axis): boolean {
  return (
    mapping.inputs.length === 1 &&
    mapping.outputs.length === 1 &&
    mapping.inputs[0] === axis.id &&
    mapping.outputs[0] === axis.id
  );
}
