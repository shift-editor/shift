import { useCallback, useEffect, useRef } from "react";
import { applyListSelection } from "@shift/editor";
import type { ListSelectionMode } from "@shift/editor/types";

export function useListSelection<T>(
  orderedItems: readonly T[],
  selectedItems: readonly T[],
  onSelectionChange: (items: readonly T[]) => void,
  isSameItem: (left: T, right: T) => boolean = Object.is,
) {
  const selectionAnchor = useRef<T | null>(null);

  useEffect(() => {
    if (selectedItems.length === 0) {
      selectionAnchor.current = null;
      return;
    }

    const [onlySelectedItem] = selectedItems;
    if (selectedItems.length !== 1 || onlySelectedItem === undefined) return;
    if (!orderedItems.some((item) => isSameItem(item, onlySelectedItem))) return;

    selectionAnchor.current = onlySelectedItem;
  }, [isSameItem, orderedItems, selectedItems]);

  const selectItem = useCallback(
    (item: T, mode: ListSelectionMode) => {
      let anchor = selectionAnchor.current;
      if (anchor !== null) {
        const currentAnchor = anchor;
        if (!orderedItems.some((candidate) => isSameItem(candidate, currentAnchor))) anchor = null;
      }

      const nextItems = applyListSelection(
        orderedItems,
        selectedItems,
        anchor,
        item,
        mode,
        isSameItem,
      );
      onSelectionChange(nextItems);
      if (mode === "single" || anchor === null) selectionAnchor.current = item;
    },
    [isSameItem, onSelectionChange, orderedItems, selectedItems],
  );

  return { selectItem };
}
