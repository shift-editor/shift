import type { AnchorId, Point2D, PointId } from "@shift/types";
import type { EditingManager } from "@/engine";
import type { AffineTransformPayload } from "@shared/bridge/FontEngineAPI";
import type { NodePositionUpdateList } from "@/types/positionUpdate";
import { createTranslationTransform } from "./affineTransform";

export class PreparedNodeTransformSession {
  #editing: EditingManager;
  #pointIds: PointId[];
  #anchorIds: AnchorId[];
  #prepared: boolean;
  #active = true;

  constructor(editing: EditingManager, pointIds: PointId[], anchorIds: AnchorId[]) {
    this.#editing = editing;
    this.#pointIds = pointIds;
    this.#anchorIds = anchorIds;
    this.#prepared = this.#editing.prepareNodeTransform(pointIds, anchorIds);
  }

  commitTranslation(delta: Point2D): void {
    if (!this.#active) return;

    const committedPreparedTransform =
      this.#prepared && this.#editing.applyPreparedNodeTransform(createTranslationTransform(delta));
    if (committedPreparedTransform) return;

    this.#editing.syncMoveNodes(this.#pointIds, this.#anchorIds, delta);
  }

  commitTransform(
    transform: AffineTransformPayload,
    fallbackUpdates: NodePositionUpdateList,
  ): void {
    if (!this.#active) return;

    const committedPreparedTransform =
      this.#prepared && this.#editing.applyPreparedNodeTransform(transform);
    if (committedPreparedTransform) return;
    if (fallbackUpdates.length === 0) return;

    this.#editing.syncNodePositions(fallbackUpdates);
  }

  dispose(): void {
    if (!this.#active) return;
    this.#active = false;

    if (this.#prepared) {
      this.#editing.clearPreparedNodeTransform();
    }
  }
}
