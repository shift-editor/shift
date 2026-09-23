import type { SelectableId } from "@shift/editor/types";
import type { ObjectTreeItem, VisibleObjectRow } from "@/types/objectTree";

export function flattenVisibleObjectRows(
  items: readonly ObjectTreeItem[],
  collapsedObjectIds: ReadonlySet<SelectableId>,
): readonly VisibleObjectRow[] {
  const rows: VisibleObjectRow[] = [];

  function appendRows(children: readonly ObjectTreeItem[], depth: number): void {
    for (const item of children) {
      rows.push({ depth, item });
      if (collapsedObjectIds.has(item.id)) continue;

      appendRows(item.children, depth + 1);
    }
  }

  appendRows(items, 0);
  return rows;
}
