import type { GlyphSnapshot } from "@shift/types";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

export interface GlyphDraft {
  readonly base: GlyphSnapshot;
  setPositions(updates: NodePositionUpdateList): void;
  finish(label: string): void;
  discard(): void;
}
