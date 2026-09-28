import { useCallback, useRef, type MouseEvent } from "react";

/**
 * Shift-click range toggling for checkbox lists.
 *
 * @remarks
 * Record the modifier with `onMouseDown` on each row, then resolve which items
 * a checkbox change applies to with `itemsToChange`: a shift-click covers the
 * range from the last plainly clicked item, any other change only the target.
 *
 * @param orderedItems - Items in display order.
 */
export function useCheckboxRange<T>(orderedItems: readonly T[]) {
  const anchorRef = useRef<T | null>(null);
  const extendRangeRef = useRef(false);

  const onMouseDown = useCallback((event: MouseEvent) => {
    extendRangeRef.current = event.shiftKey;
  }, []);

  const itemsToChange = useCallback(
    (target: T): readonly T[] => {
      const extendRange = extendRangeRef.current;
      extendRangeRef.current = false;
      const targetIndex = orderedItems.indexOf(target);
      const anchorIndex = anchorRef.current === null ? -1 : orderedItems.indexOf(anchorRef.current);
      if (!extendRange || anchorIndex === -1 || targetIndex === -1) {
        anchorRef.current = target;
        return [target];
      }

      return orderedItems.slice(
        Math.min(anchorIndex, targetIndex),
        Math.max(anchorIndex, targetIndex) + 1,
      );
    },
    [orderedItems],
  );

  const resetRange = useCallback(() => {
    anchorRef.current = null;
  }, []);

  return { onMouseDown, itemsToChange, resetRange };
}
