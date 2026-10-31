import type {
  DesignAxisLocation,
  ExternalAxisLocation,
  VariationReader,
} from "../../types/variation";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;

export type MappingAcceptsExternalLocation = Assert<
  Equal<Parameters<VariationReader["toDesign"]>[0], ExternalAxisLocation>
>;
export type MappingReturnsDesignLocation = Assert<
  Equal<ReturnType<VariationReader["toDesign"]>, DesignAxisLocation>
>;
export type CoordinateSpacesRemainDistinct = Assert<
  DesignAxisLocation extends ExternalAxisLocation ? false : true
>;
