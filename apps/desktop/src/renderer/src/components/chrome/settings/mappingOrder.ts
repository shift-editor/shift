import {
  ascending,
  comparing,
  type Axis,
  type AxisMappingPoint,
  type Comparator,
} from "@shift/types";

/** A mapping point read along one axis. */
interface MappingCoordinate {
  readonly input: number;
}

/** Mapping coordinates in input order, the order the mapping curve runs. */
export const byInput: Comparator<MappingCoordinate> = comparing((point) => point.input, ascending);

/** Mapping points in input order along `axis`; a point without a value there sits at its default. */
export function byMappingInput(axis: Axis): Comparator<AxisMappingPoint> {
  return comparing((point) => point.input.values[axis.id] ?? axis.default, ascending);
}
