import type { NodeId } from "@shift/types";

/** How long after a click its second click still makes a double-click. */
const DOUBLE_CLICK_MS = 500;
/** How far, in pixels, the second click may land from the first. */
const DOUBLE_CLICK_SLOP = 4;

/** One click on a page's row: which page, where in the viewport, and when. */
export interface PageRowClick {
  readonly pageId: NodeId;
  readonly x: number;
  readonly y: number;
  /** Milliseconds, as `event.timeStamp` reports them. */
  readonly at: number;
}

/**
 * Recognises a double-click that renames a page across a view swap.
 *
 * @remarks
 * Clicking a page's row in the font overview shows its canvas, which has its
 * own pages list, so the second click of a double-click lands on the same
 * page's row in the other list, a different element: the browser sees two
 * single clicks. The window's session keeps the first click here, and the
 * second click on that page's row, near it and soon after, counts as the
 * double-click. Nothing listens on the window.
 */
export class PageRenameGesture {
  // non-reactive: read only by the next click on a page's row.
  #firstClick: PageRowClick | null = null;

  /** Remembers a click that opened a page from another view. */
  opened(click: PageRowClick): void {
    this.#firstClick = click;
  }

  /**
   * Whether `click` on a page's row completes a double-click begun in another view.
   *
   * @remarks
   * Either way the first click is forgotten, so a third click starts over.
   */
  completes(click: PageRowClick): boolean {
    const first = this.#firstClick;
    this.#firstClick = null;
    if (!first || first.pageId !== click.pageId) return false;

    const soon = click.at - first.at <= DOUBLE_CLICK_MS;
    const near = Math.hypot(click.x - first.x, click.y - first.y) <= DOUBLE_CLICK_SLOP;
    return soon && near;
  }
}
