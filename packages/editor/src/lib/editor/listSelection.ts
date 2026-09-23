import type { ListSelectionMode } from "../../types/listSelection";

export function applyListSelection<T>(
  orderedIds: readonly T[],
  selectedIds: readonly T[],
  selectionAnchorId: T | null,
  targetId: T,
  mode: ListSelectionMode,
): readonly T[] {
  const targetIndex = orderedIds.indexOf(targetId);
  if (targetIndex === -1) return selectedIds;

  switch (mode) {
    case "single":
      return [targetId];
    case "range": {
      const anchorIndex = selectionAnchorId === null ? -1 : orderedIds.indexOf(selectionAnchorId);
      if (anchorIndex === -1) return [targetId];

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      return orderedIds.slice(start, end + 1);
    }
    case "toggle":
      return selectedIds.includes(targetId)
        ? selectedIds.filter((id) => id !== targetId)
        : [...selectedIds, targetId];
  }
}
