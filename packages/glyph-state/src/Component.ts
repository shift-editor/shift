import {
  AFFINE_COMPONENT_VALUE_OFFSETS,
  type ComponentData,
  type ComponentId,
  type ComponentTransformKind,
  type GlyphId,
  type GlyphName,
  type GlyphStructure,
} from "@shift/types";
import { Mat, type DecomposedTransform, type MatModel } from "@shift/geo";
import { componentValueCount, componentsValueOffset, readDecomposedTransform } from "./valueLayout";

export type Matrix = MatModel;

export class Component {
  readonly #data: ComponentData;
  readonly #values: Float64Array;
  readonly #cursor: number;
  readonly #transformKind: ComponentTransformKind;

  constructor(
    data: ComponentData,
    values: Float64Array,
    cursor: number,
    transformKind: ComponentTransformKind,
  ) {
    this.#data = data;
    this.#values = values;
    this.#cursor = cursor;
    this.#transformKind = transformKind;
  }

  static fromStructure(
    structure: GlyphStructure,
    values: Float64Array,
    transformKind: ComponentTransformKind,
  ): readonly Component[] {
    const cursor = componentsValueOffset(structure);
    const stride = componentValueCount(transformKind);
    return structure.components.map(
      (component, index) =>
        new Component(component, values, cursor + index * stride, transformKind),
    );
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

  get transform(): DecomposedTransform {
    if (this.#transformKind === "affine") return Mat.toDecomposed(this.matrix);

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

    return Mat.fromDecomposed(this.transform);
  }
}
