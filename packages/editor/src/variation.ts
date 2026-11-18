export { interpolateSourceValues } from "./lib/interpolation/InterpolationBasis";
export { atlasWeights, FontVariation } from "./lib/wasm/variation";
export {
  asExternalAxisLocation,
  axisValue,
  defaultExternalAxisLocation,
  designAxisLocationFromLocation,
  designAxisLocationsEqual,
  emptyExternalAxisLocation,
  externalAxisLocationFromLocation,
  externalAxisLocationFromRecord,
  locationFromDesignAxisLocation,
  withExternalAxisValue,
  withGlyphLocation,
} from "./lib/variation/location";
export { Designspace } from "./lib/variation/Designspace";
export { independentMappingFor, withIndependentMapping } from "./lib/variation/independentMapping";
export type { DesignAxisLocation, ExternalAxisLocation } from "./types/variation";
export { GlyphSpace } from "./lib/model/GlyphSpace";
