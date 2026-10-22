import type { NodeId } from "@shift/types";

/** One row of a frame's Children list in the Layout section. */
export interface FrameChildRow {
  readonly id: NodeId;
  /** A frame's name, or a run's size and length. */
  readonly label: string;
}
