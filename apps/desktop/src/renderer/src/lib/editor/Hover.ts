import type { SegmentId } from "@shift/glyph-state";
import type { AnchorId, PointId } from "@shift/types";
import { computed, signal, type Signal, type WritableSignal } from "../signals";

export interface PointHover {
  readonly kind: "point";
  readonly pointId: PointId;
}

export interface AnchorHover {
  readonly kind: "anchor";
  readonly anchorId: AnchorId;
}

export interface SegmentHover {
  readonly kind: "segment";
  readonly segmentId: SegmentId;
}

export type HoverEntry = PointHover | AnchorHover | SegmentHover;
export type HoverableId = PointId | AnchorId | SegmentId;

/**
 * Stores scene-scoped hover identity.
 *
 * Hover is transient identity-only state. It owns no glyph models, glyph layers,
 * geometry, or hit-test policy; tools replace it after resolving scene items.
 */
export class Hover {
  readonly #entry: WritableSignal<HoverEntry | null>;
  readonly #id: Signal<HoverableId | null>;

  constructor() {
    this.#entry = signal<HoverEntry | null>(null, { name: "editor.hover" });
    this.#id = computed(
      () => {
        const entry = this.#entry.value;
        return entry ? hoverId(entry) : null;
      },
      { name: "editor.hover.id" },
    );
  }

  get entryCell(): Signal<HoverEntry | null> {
    return this.#entry;
  }

  get entry(): HoverEntry | null {
    return this.#entry.peek();
  }

  get id(): HoverableId | null {
    return this.#id.peek();
  }

  get hasHover(): boolean {
    return this.#id.peek() !== null;
  }

  isHovered(entry: HoverEntry): boolean {
    return this.has(hoverId(entry));
  }

  has(id: HoverableId): boolean {
    return this.#id.peek() === id;
  }

  set(entry: HoverEntry | null): void {
    this.#entry.set(entry);
  }

  clear(): void {
    this.#entry.set(null);
  }
}

function hoverId(entry: HoverEntry): HoverableId {
  switch (entry.kind) {
    case "point":
      return entry.pointId;
    case "anchor":
      return entry.anchorId;
    case "segment":
      return entry.segmentId;
  }
}
