import type { ComponentData, ComponentId, GlyphId, GlyphName, GlyphStructure } from "@shift/types";
import { Mat, type DecomposedTransform, type MatModel } from "@shift/geo";

export type ComponentTransform = DecomposedTransform;
export type Matrix = MatModel;

export class Component {
  readonly #data: ComponentData;
  readonly #values: Float64Array;
  readonly #cursor: number;

  constructor(data: ComponentData, values: Float64Array, cursor: number) {
    this.#data = data;
    this.#values = values;
    this.#cursor = cursor;
  }

  static fromStructure(structure: GlyphStructure, values: Float64Array): readonly Component[] {
    let cursor = 1;
    for (const contour of structure.contours) cursor += contour.points.length * 2;
    cursor += structure.anchors.length * 2;

    return structure.components.map(
      (component, index) => new Component(component, values, cursor + index * 9),
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
    return Mat.fromDecomposed(this.transform);
  }
}
