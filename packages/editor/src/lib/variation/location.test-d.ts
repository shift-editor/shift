import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import type { FontVariation } from "../wasm/variation";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;

export type MappingAcceptsExternalLocation = Assert<
  Equal<Parameters<FontVariation["toDesign"]>[0], ExternalAxisLocation>
>;
export type MappingReturnsDesignLocation = Assert<
  Equal<ReturnType<FontVariation["toDesign"]>, DesignAxisLocation>
>;
export type CoordinateSpacesRemainDistinct = Assert<
  DesignAxisLocation extends ExternalAxisLocation ? false : true
>;
