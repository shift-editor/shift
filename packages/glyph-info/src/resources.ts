import { componentResources } from "./componentResources.js";
import { coreResources } from "./coreResources.js";
import type { GlyphInfoResources } from "./types.js";

export const defaultResources: GlyphInfoResources = {
  ...coreResources,
  ...componentResources,
};
