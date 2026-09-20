import type { DesignAxisLocation, ExternalAxisLocation } from "@shift/editor/types/variation";
import type { mapAxisLocation } from "@shift/editor/lib/variation/location";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;

export type MappingAcceptsExternalLocation = Assert<
  Equal<Parameters<typeof mapAxisLocation>[0], ExternalAxisLocation>
>;
export type MappingReturnsDesignLocation = Assert<
  Equal<ReturnType<typeof mapAxisLocation>, DesignAxisLocation>
>;
export type CoordinateSpacesRemainDistinct = Assert<
  DesignAxisLocation extends ExternalAxisLocation ? false : true
>;
