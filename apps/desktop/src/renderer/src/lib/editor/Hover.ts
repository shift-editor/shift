import type { SegmentId } from "@shift/glyph-state";
import type { AnchorId, PointId } from "@shift/types";
import { signal, type Signal, type WritableSignal } from "../signals";

interface PointHover {
  type: "point";
  pointId: PointId;
}

interface AnchorHover {
  type: "anchor";
  anchorId: AnchorId;
}

interface SegmentHover {
  type: "segment";
  segmentId: SegmentId;
}

export type HoverState = PointHover | AnchorHover | SegmentHover | null;

/**
 * Runtime hover state for glyph-domain targets in the editor session.
 *
 * `Hover` only records which glyph object is currently under the pointer. It
 * does not perform hit testing, decide priority between target kinds, or hold
 * tool-specific visual state such as bounding-box handles, pen endpoints, text
 * carets, or marquee feedback. Tools update this state from pointer behavior
 * after reading an explicit geometry surface.
 */
export class Hover {
  readonly #target: WritableSignal<HoverState>;

  constructor() {
    this.#target = signal<HoverState>(null, { name: "editor.hover.target" });
  }

  get targetCell(): Signal<HoverState> {
    return this.#target;
  }

  get target(): HoverState | null {
    return this.#target.peek();
  }

  get hasTarget(): boolean {
    return this.#target.peek() !== null;
  }

  get pointId(): PointId | null {
    const target = this.#target.peek();
    return target?.type === "point" ? target.pointId : null;
  }

  get anchorId(): AnchorId | null {
    const target = this.#target.peek();
    return target?.type === "anchor" ? target.anchorId : null;
  }

  get segmentId(): SegmentId | null {
    const target = this.#target.peek();
    return target?.type === "segment" ? target.segmentId : null;
  }

  /**
   * Replace the current glyph hover target.
   *
   * Passing `null` clears hover. The caller owns the policy that chose this
   * target, including which geometry surface was queried and which hit kind won.
   */
  set(target: HoverState | null): void {
    this.#target.set(target);
  }

  clear(): void {
    this.#target.set(null);
  }
}
