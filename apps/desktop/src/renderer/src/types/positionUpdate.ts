import type { AnchorId, PointId } from "@shift/types";

export type NodeRef =
  | { kind: "point"; id: PointId }
  | { kind: "anchor"; id: AnchorId }
  | { kind: "guideline"; id: string };

export interface NodePositionUpdate {
  node: NodeRef;
  x: number;
  y: number;
}

export type NodePositionUpdateList = readonly NodePositionUpdate[];
