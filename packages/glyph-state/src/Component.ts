import type {
  ComponentData,
  ComponentId,
  ComponentTransformKind,
  GlyphId,
  GlyphName,
  GlyphStructure,
} from "@shift/types";
import { Mat, type DecomposedTransform, type MatModel } from "@shift/geo";

export type ComponentTransform = DecomposedTransform;
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
    let cursor = 1;
    for (const contour of structure.contours) cursor += contour.points.length * 2;
    cursor += structure.anchors.length * 2;

    const stride = transformKind === "affine" ? 6 : 9;
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

  get transform(): ComponentTransform {
    if (this.#transformKind === "affine") return Mat.toDecomposed(this.matrix);

    return {
      translateX: this.#values[this.#cursor],
      translateY: this.#values[this.#cursor + 1],
      rotation: this.#values[this.#cursor + 2],
      scaleX: this.#values[this.#cursor + 3],
      scaleY: this.#values[this.#cursor + 4],
      skewX: this.#values[this.#cursor + 5],
      skewY: this.#values[this.#cursor + 6],
      tCenterX: this.#values[this.#cursor + 7],
      tCenterY: this.#values[this.#cursor + 8],
    };
  }

  get matrix(): MatModel {
    if (this.#transformKind === "affine") {
      return {
        a: this.#values[this.#cursor],
        b: this.#values[this.#cursor + 1],
        c: this.#values[this.#cursor + 2],
        d: this.#values[this.#cursor + 3],
        e: this.#values[this.#cursor + 4],
        f: this.#values[this.#cursor + 5],
      };
    }

    return Mat.fromDecomposed(this.transform);
  }
}
