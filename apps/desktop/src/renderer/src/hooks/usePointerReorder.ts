import { useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/** How far, in pixels, a press moves before it becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;
const ROW_SELECTOR = "[data-reorder-id]";

/** A drag in progress: the dragged row and the gap it would drop into. */
export interface ReorderDrag {
  readonly id: string;
  readonly from: number;
  /** The gap between rows it would drop into: 0 before the first row, `ids.length` after the last. */
  readonly to: number;
}

/**
 * Drag-to-reorder for a vertical list whose rows carry `data-reorder-id`.
 *
 * @remarks
 * A press that moves past a few pixels drags the row; the gap under the pointer
 * is where it would drop. Releasing reports the row's index in the list after
 * the move, and the click that ends a drag is swallowed so the row does not
 * also activate. A drop back where it started reports nothing.
 *
 * @param ids - the rows in list order.
 * @param onMove - moves a row to `index`, its position among the rows after the move.
 */
export function usePointerReorder(
  ids: readonly string[],
  onMove: (id: string, index: number) => void,
) {
  const [drag, setDrag] = useState<ReorderDrag | null>(null);
  const swallowClick = useRef(false);

  const startDrag = (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const list = event.currentTarget.parentElement;
    const from = ids.indexOf(id);
    if (!list || from < 0) return;

    const startY = event.clientY;
    let dragging = false;
    let to = from;

    const onPointerMove = (move: PointerEvent) => {
      if (!dragging && Math.abs(move.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      const rows = [...list.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
      const below = rows.findIndex((row) => {
        const bounds = row.getBoundingClientRect();
        return move.clientY < bounds.top + bounds.height / 2;
      });
      to = below < 0 ? rows.length : below;
      setDrag({ id, from, to });
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      setDrag(null);
      if (!dragging) return;

      swallowClick.current = true;
      const index = to > from ? to - 1 : to;
      if (index !== from) onMove(id, index);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  /** Swallows the click that ends a drag; put it on each row as `onClickCapture`. */
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  /** Whether a drop line belongs before the row at `index`, or after the last row for `ids.length`. */
  const dropsBefore = (index: number): boolean =>
    drag !== null && drag.to === index && drag.to !== drag.from && drag.to !== drag.from + 1;

  return { drag, startDrag, onClickCapture, dropsBefore };
}
