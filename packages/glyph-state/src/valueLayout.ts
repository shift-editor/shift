import type { DecomposedTransform } from "@shift/geo";
import {
  AFFINE_COMPONENT_VALUE_COUNT,
  DECOMPOSED_COMPONENT_VALUE_COUNT,
  DECOMPOSED_COMPONENT_VALUE_OFFSETS,
  GLYPH_ADVANCE_VALUE_COUNT,
  GLYPH_ANCHOR_VALUE_COUNT,
  GLYPH_POINT_VALUE_COUNT,
  type ComponentTransformKind,
  type GlyphStructure,
} from "@shift/types";

/** Value-buffer offset of the first contour point's `x` coordinate. */
export const CONTOURS_VALUE_OFFSET = GLYPH_ADVANCE_VALUE_COUNT;

/**
 * Returns the value-buffer offset of the first anchor's `x` coordinate.
 *
 * @param structure - Topology that the value buffer is laid out for.
 */
export function anchorsValueOffset(structure: GlyphStructure): number {
  let cursor = CONTOURS_VALUE_OFFSET;
  for (const contour of structure.contours)
    cursor += contour.points.length * GLYPH_POINT_VALUE_COUNT;
  return cursor;
}

/**
 * Returns the value-buffer offset of the first component transform.
 *
 * @param structure - Topology that the value buffer is laid out for.
 */
export function componentsValueOffset(structure: GlyphStructure): number {
  return anchorsValueOffset(structure) + structure.anchors.length * GLYPH_ANCHOR_VALUE_COUNT;
}

/**
 * Returns how many values one component transform occupies.
 *
 * @param transformKind - Encoding the value buffer uses for component transforms.
 */
export function componentValueCount(transformKind: ComponentTransformKind): number {
  return transformKind === "affine"
    ? AFFINE_COMPONENT_VALUE_COUNT
    : DECOMPOSED_COMPONENT_VALUE_COUNT;
}

/**
 * Reads one decomposed component transform from a value buffer.
 *
 * @param values - Buffer holding decomposed transform values.
 * @param offset - Index of the transform's first value.
 */
export function readDecomposedTransform(values: Float64Array, offset: number): DecomposedTransform {
  const fields = DECOMPOSED_COMPONENT_VALUE_OFFSETS;
  return {
    translateX: values[offset + fields.translateX],
    translateY: values[offset + fields.translateY],
    rotation: values[offset + fields.rotation],
    scaleX: values[offset + fields.scaleX],
    scaleY: values[offset + fields.scaleY],
    skewX: values[offset + fields.skewX],
    skewY: values[offset + fields.skewY],
    tCenterX: values[offset + fields.tCenterX],
    tCenterY: values[offset + fields.tCenterY],
  };
}

/**
 * Encodes one component transform in the decomposed value layout.
 *
 * @returns A new buffer of `DECOMPOSED_COMPONENT_VALUE_COUNT` values.
 */
export function decomposedTransformValues(transform: DecomposedTransform): Float64Array {
  const fields = DECOMPOSED_COMPONENT_VALUE_OFFSETS;
  const values = new Float64Array(DECOMPOSED_COMPONENT_VALUE_COUNT);
  values[fields.translateX] = transform.translateX;
  values[fields.translateY] = transform.translateY;
  values[fields.rotation] = transform.rotation;
  values[fields.scaleX] = transform.scaleX;
  values[fields.scaleY] = transform.scaleY;
  values[fields.skewX] = transform.skewX;
  values[fields.skewY] = transform.skewY;
  values[fields.tCenterX] = transform.tCenterX;
  values[fields.tCenterY] = transform.tCenterY;
  return values;
}
