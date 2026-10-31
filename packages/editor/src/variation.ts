export { interpolateSourceValues } from "./lib/interpolation/InterpolationBasis";
export {
  externalAxisLocationForDesignLocation,
  interpolationWeights,
  mapAxisLocation,
} from "./lib/wasm/variation";
export {
  axisValue,
  defaultExternalAxisLocation,
  designAxisLocationFromLocation,
  designAxisLocationsEqual,
  emptyExternalAxisLocation,
  externalAxisLocationFromLocation,
  externalAxisLocationFromRecord,
  locationFromDesignAxisLocation,
  withExternalAxisValue,
} from "./lib/variation/location";
export { Designspace } from "./lib/variation/Designspace";
export { independentMappingFor, withIndependentMapping } from "./lib/variation/independentMapping";
export type { DesignAxisLocation, ExternalAxisLocation } from "./types/variation";
