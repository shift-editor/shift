import type { AnchorId, Point2D, PointId } from "@shift/types";
import type { EditingManager } from "@/engine";

export class PreparedNodeMoveSession {
  #editing: EditingManager;
  #pointIds: PointId[];
  #anchorIds: AnchorId[];
  #prepared: boolean;
  #active = true;

  constructor(editing: EditingManager, pointIds: PointId[], anchorIds: AnchorId[]) {
    this.#editing = editing;
    this.#pointIds = pointIds;
    this.#anchorIds = anchorIds;
    this.#prepared = this.#editing.prepareNodeTranslation(pointIds, anchorIds);
  }

  commitUniformDelta(delta: Point2D): void {
    if (!this.#active) return;

    const committedPreparedMove =
      this.#prepared && this.#editing.applyPreparedNodeTranslation(delta);
    if (committedPreparedMove) return;

    this.#editing.syncMoveNodes(this.#pointIds, this.#anchorIds, delta);
  }

  dispose(): void {
    if (!this.#active) return;
    this.#active = false;

    if (this.#prepared) {
      this.#editing.clearPreparedNodeTranslation();
    }
  }
}
