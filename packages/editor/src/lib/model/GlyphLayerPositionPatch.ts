import type { GlyphPositions } from "@shift/glyph-state";
import type { AnchorId, PointId } from "@shift/types";

export type BridgePositionPatchPayload = readonly [
  pointIds: PointId[] | null,
  pointCoords: Float64Array | null,
  anchorIds: AnchorId[] | null,
  anchorCoords: Float64Array | null,
];

/**
 * Sparse authored-layer position patch.
 *
 * `GlyphPositions` is the domain shape used by tools, commands, and layer
 * editing. `GlyphLayerPositionPatch` is the model/bridge boundary: it keeps bridge
 * transport encoding out of geometry and tools, so the N-API payload can change
 * without changing editor behavior code.
 */
export class GlyphLayerPositionPatch {
  readonly positions: GlyphPositions;

  private constructor(positions: GlyphPositions) {
    this.positions = [...positions];
  }

  static from(positions: GlyphPositions): GlyphLayerPositionPatch {
    return new GlyphLayerPositionPatch(positions);
  }

  get isEmpty(): boolean {
    return this.positions.length === 0;
  }

  toBridgePayload(): BridgePositionPatchPayload {
    const pointIds: PointId[] = [];
    const pointCoords: number[] = [];
    const anchorIds: AnchorId[] = [];
    const anchorCoords: number[] = [];

    for (const position of this.positions) {
      switch (position.kind) {
        case "point":
          pointIds.push(position.id);
          pointCoords.push(position.x, position.y);
          break;
        case "anchor":
          anchorIds.push(position.id);
          anchorCoords.push(position.x, position.y);
          break;
      }
    }

    return [
      pointIds.length > 0 ? pointIds : null,
      pointCoords.length > 0 ? Float64Array.from(pointCoords) : null,
      anchorIds.length > 0 ? anchorIds : null,
      anchorCoords.length > 0 ? Float64Array.from(anchorCoords) : null,
    ];
  }
}
