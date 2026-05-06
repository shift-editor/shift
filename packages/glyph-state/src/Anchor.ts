import type { AnchorData, AnchorId, GlyphStructure } from "@shift/types";

export class Anchor {
  readonly #data: AnchorData;
  readonly #values: Float64Array;
  readonly #cursor: number;

  constructor(data: AnchorData, values: Float64Array, cursor: number) {
    this.#data = data;
    this.#values = values;
    this.#cursor = cursor;
  }

  static fromStructure(structure: GlyphStructure, values: Float64Array): readonly Anchor[] {
    let cursor = 1;
    for (const contour of structure.contours) cursor += contour.points.length * 2;

    return structure.anchors.map((anchor, index) => new Anchor(anchor, values, cursor + index * 2));
  }

  static valueOffsets(structure: GlyphStructure): Map<AnchorId, number> {
    const offsets = new Map<AnchorId, number>();
    let cursor = 1;
    for (const contour of structure.contours) cursor += contour.points.length * 2;
    for (const anchor of structure.anchors) {
      offsets.set(anchor.id, cursor);
      cursor += 2;
    }
    return offsets;
  }

  get id(): AnchorId {
    return this.#data.id;
  }

  get name(): string | undefined {
    return this.#data.name;
  }

  get x(): number {
    return this.#values[this.#cursor];
  }

  get y(): number {
    return this.#values[this.#cursor + 1];
  }
}
