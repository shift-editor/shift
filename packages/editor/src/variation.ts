export { interpolateSourceValues } from "./lib/interpolation/InterpolationBasis";
export {
  atlasWeights,
  EngineVariationReader,
  StatelessVariationReader,
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
export type { DesignAxisLocation, ExternalAxisLocation, VariationReader } from "./types/variation";
