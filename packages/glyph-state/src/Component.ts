import {
  AFFINE_COMPONENT_VALUE_OFFSETS,
  type AxisId,
  type ComponentData,
  type ComponentId,
  type ComponentTransformKind,
  type GlyphId,
  type GlyphName,
  type GlyphStructure,
} from "@shift/types";
import type { DecomposedTransform, MatModel } from "@shift/geo";
import { geometry } from "@shift/wasm";
import {
  componentLocationsValueOffset,
  componentValueCount,
  componentsValueOffset,
  readDecomposedTransform,
} from "./valueLayout";

export type Matrix = MatModel;

/** The axes a component sets for its base glyph, in design units. */
export type ComponentLocation = ReadonlyMap<AxisId, number>;

export class Component {
  readonly #data: ComponentData;
  readonly #values: Float64Array;
  readonly #cursor: number;
  readonly #locationCursor: number;
  readonly #transformKind: ComponentTransformKind;

  constructor(
    data: ComponentData,
    values: Float64Array,
    cursor: number,
    locationCursor: number,
    transformKind: ComponentTransformKind,
  ) {
    this.#data = data;
    this.#values = values;
    this.#cursor = cursor;
    this.#locationCursor = locationCursor;
    this.#transformKind = transformKind;
  }

  static fromStructure(
    structure: GlyphStructure,
    values: Float64Array,
    transformKind: ComponentTransformKind,
  ): readonly Component[] {
    const cursor = componentsValueOffset(structure);
    const stride = componentValueCount(transformKind);
    // Location values follow every transform, component by component.
    let locationCursor = componentLocationsValueOffset(structure, transformKind);
    return structure.components.map((component, index) => {
      const built = new Component(
        component,
        values,
        cursor + index * stride,
        locationCursor,
        transformKind,
      );
      locationCursor += component.locationAxes.length;
      return built;
    });
  }

  get id(): ComponentId {
    return this.#data.id;
  }

  get baseGlyphId(): GlyphId {
    return this.#data.baseGlyphId;
  }

  get baseGlyphName(): GlyphName {
    return this.#data.baseGlyphName;
  }

  /**
   * Whether the component is placed by its anchors (`anchored`) or by hand
   * (`free`); `unset` counts as anchored while it sits exactly on its anchors.
   */
  get alignment(): NonNullable<ComponentData["alignment"]> {
    return this.#data.alignment ?? "unset";
  }

  /** The axes this component sets for its base glyph, in design units; empty when it sets none. */
  get location(): ComponentLocation {
    const axes = this.#data.locationAxes;
    return new Map(
      axes.map((axisId, index) => [axisId, this.#values[this.#locationCursor + index]]),
    );
  }

  /**
   * Where the base glyph takes the axes {@link location} doesn't set: the
   * glyph the component sits in (`parent`) or the font's default location (`font`).
   */
  get inheritance(): ComponentData["inheritance"] {
    return this.#data.inheritance;
  }

  get transform(): DecomposedTransform {
    if (this.#transformKind === "affine") return geometry.decomposeMatrix(this.matrix);

    return readDecomposedTransform(this.#values, this.#cursor);
  }

  get matrix(): MatModel {
    if (this.#transformKind === "affine") {
      const offsets = AFFINE_COMPONENT_VALUE_OFFSETS;
      return {
        a: this.#values[this.#cursor + offsets.xx],
        b: this.#values[this.#cursor + offsets.xy],
        c: this.#values[this.#cursor + offsets.yx],
        d: this.#values[this.#cursor + offsets.yy],
        e: this.#values[this.#cursor + offsets.dx],
        f: this.#values[this.#cursor + offsets.dy],
      };
    }

    return geometry.composeTransform(this.transform);
  }
}
