import type { AnchorId, PointId } from "@shift/types";

export interface PointPositionUpdate {
  nodeType: "point";
  id: PointId;
  x: number;
  y: number;
}

export interface AnchorPositionUpdate {
  nodeType: "anchor";
  id: AnchorId;
  x: number;
  y: number;
}

export type NodePositionUpdate = PointPositionUpdate | AnchorPositionUpdate;
export type NodePositionUpdateList = readonly NodePositionUpdate[];
