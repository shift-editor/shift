import type { ComputedSignal } from "@/lib/signals";
import { computed } from "@/lib/signals";

/**
 * Base class for canvas items with reactive drawing/query props.
 *
 * `props()` is the reactive phase: subclasses may read signals and should
 * return plain derived data for drawing, hit testing, and cursor queries.
 * Public drawing/query methods should read `propsCell.value` or
 * `propsSnapshot()` and avoid reading other signals directly.
 *
 * @typeParam Props - Plain derived data used by the concrete canvas item.
 */
export abstract class CanvasItem<Props> {
  readonly propsCell: ComputedSignal<Props | null>;

  protected constructor() {
    this.propsCell = computed(() => this.props(), {
      name: `${this.constructor.name}.props`,
    });
  }

  /**
   * Build the current props for this item.
   *
   * @returns Props for the current render/query state, or `null` when the item
   * should not draw or answer hits.
   */
  protected abstract props(): Props | null;

  /**
   * Read the latest props without subscribing the caller.
   *
   * @returns The current props snapshot, or `null` when the item is inactive.
   */
  propsSnapshot(): Props | null {
    return this.propsCell.peek();
  }
}
