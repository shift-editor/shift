import type { ComponentData, ComponentId, GlyphName, GlyphStructure } from "@shift/types";

export interface ComponentTransform {
  readonly translateX: number;
  readonly translateY: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly skewX: number;
  readonly skewY: number;
  readonly tCenterX: number;
  readonly tCenterY: number;
}

export type Matrix = { xx: number; xy: number; yx: number; yy: number; dx: number; dy: number };

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

  get matrix(): Matrix {
    return decomposedToMatrix(this.transform);
  }
}

function decomposedToMatrix(t: ComponentTransform): Matrix {
  const cosR = Math.cos((t.rotation * Math.PI) / 180);
  const sinR = Math.sin((t.rotation * Math.PI) / 180);
  const tanSx = Math.tan((t.skewX * Math.PI) / 180);
  const tanSy = Math.tan((t.skewY * Math.PI) / 180);

  const xx = t.scaleX * cosR + t.scaleY * tanSx * sinR;
  const xy = t.scaleX * sinR - t.scaleY * tanSx * cosR;
  const yx = t.scaleY * -sinR + t.scaleX * tanSy * cosR;
  const yy = t.scaleY * cosR + t.scaleX * tanSy * sinR;

  const dx = t.translateX + t.tCenterX - (xx * t.tCenterX + yx * t.tCenterY);
  const dy = t.translateY + t.tCenterY - (xy * t.tCenterX + yy * t.tCenterY);

  return { xx, xy, yx, yy, dx, dy };
}
