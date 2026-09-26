import type { ListSelectionMode } from "../../types/listSelection";

export function applyListSelection<T>(
  orderedItems: readonly T[],
  selectedItems: readonly T[],
  selectionAnchor: T | null,
  targetItem: T,
  mode: ListSelectionMode,
  isSameItem: (left: T, right: T) => boolean = Object.is,
): readonly T[] {
  const targetIndex = orderedItems.findIndex((item) => isSameItem(item, targetItem));
  if (targetIndex === -1) return selectedItems;

  switch (mode) {
    case "single":
      return [targetItem];
    case "range": {
      const anchorIndex =
        selectionAnchor === null
          ? -1
          : orderedItems.findIndex((item) => isSameItem(item, selectionAnchor));
      if (anchorIndex === -1) return [targetItem];

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      return orderedItems.slice(start, end + 1);
    }
    case "toggle":
      return selectedItems.some((item) => isSameItem(item, targetItem))
        ? selectedItems.filter((item) => !isSameItem(item, targetItem))
        : [...selectedItems, targetItem];
  }
}
