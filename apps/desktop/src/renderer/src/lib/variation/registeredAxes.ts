/**
 * Lists the design-variation axes registered by the OpenType specification.
 *
 * @remarks
 * Registration fixes a tag's meaning and numeric scale, but does not prescribe
 * one universal authored range or `fvar` default for every font.
 *
 * @see https://learn.microsoft.com/en-us/typography/opentype/spec/dvaraxisreg
 */
export const REGISTERED_OPENTYPE_AXES = [
  { tag: "wght", name: "Weight" },
  { tag: "wdth", name: "Width" },
  { tag: "opsz", name: "Optical Size" },
  { tag: "slnt", name: "Slant" },
  { tag: "ital", name: "Italic" },
] as const;

const REGISTERED_OPENTYPE_AXIS_TAGS = new Set<string>(
  REGISTERED_OPENTYPE_AXES.map((axis) => axis.tag),
);

/**
 * Returns whether a tag has semantics registered by OpenType.
 *
 * @param tag - Four-character authored axis tag to classify.
 * @returns `true` only for tags in the OpenType design-variation axis registry.
 */
export function isRegisteredOpenTypeAxisTag(tag: string): boolean {
  return REGISTERED_OPENTYPE_AXIS_TAGS.has(tag);
}
