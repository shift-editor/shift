import type { GlyphLayer } from "../../model/Glyph";
import type { SpacingHalf } from "./RunSpacing";
import type { SpacingSnap } from "./types";

/** A sidebearing value a dragged half can snap to. */
export interface SnapTarget {
  readonly kind: SpacingSnap;
  readonly sidebearing: number;
}

/** The values a dragged sidebearing snaps to, fixed when the drag starts. */
export class SnapTargets {
  readonly #targets: readonly SnapTarget[];

  private constructor(targets: readonly SnapTarget[]) {
    this.#targets = targets;
  }

  /** The gap's other half and the dragged glyph's own other sidebearing, where they exist. */
  static for(half: SpacingHalf, layer: GlyphLayer): SnapTargets {
    const targets: SnapTarget[] = [];

    const otherHalf = half.other()?.glyphSide;
    if (otherHalf) targets.push({ kind: "otherHalf", sidebearing: otherHalf.sidebearing });

    const opposite = half.oppositeSidebearing(layer);
    if (opposite !== null) targets.push({ kind: "otherSidebearing", sidebearing: opposite });

    return new SnapTargets(targets);
  }

  /** The target nearest `value` within `reach` units, if any. */
  nearest(value: number, reach: number): SnapTarget | null {
    let nearest: SnapTarget | null = null;
    for (const target of this.#targets) {
      const distance = Math.abs(target.sidebearing - value);
      if (distance > reach) continue;
      if (!nearest || distance < Math.abs(nearest.sidebearing - value)) nearest = target;
    }
    return nearest;
  }
}
