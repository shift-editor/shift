import type { SelectableId } from "@shift/types";
import type { ObjectTreeItem, VisibleObjectRow } from "@/types/objectTree";

/**
 * Rows for an item's children when none of them has children of its own, by item.
 *
 * @remarks
 * Such rows depend only on the item and their depth. The object tree reuses an
 * unchanged contour's item across edits, so its point rows are reused too.
 */
const leafChildRows = new WeakMap<ObjectTreeItem, { depth: number; rows: VisibleObjectRow[] }>();

export function flattenVisibleObjectRows(
  items: readonly ObjectTreeItem[],
  collapsedObjectIds: ReadonlySet<SelectableId>,
): readonly VisibleObjectRow[] {
  const rows: VisibleObjectRow[] = [];

  function appendRows(children: readonly ObjectTreeItem[], depth: number): void {
    for (const [index, item] of children.entries()) {
      rows.push({ depth, item, position: index + 1, setSize: children.length });
      if (collapsedObjectIds.has(item.id)) continue;

      const leafRows = childRowsIfLeaves(item, depth + 1);
      if (leafRows) {
        for (const row of leafRows) rows.push(row);
      } else {
        appendRows(item.children, depth + 1);
      }
    }
  }

  appendRows(items, 0);
  return rows;
}

function childRowsIfLeaves(item: ObjectTreeItem, depth: number): VisibleObjectRow[] | null {
  const cached = leafChildRows.get(item);
  if (cached?.depth === depth) return cached.rows;
  if (item.children.some((child) => child.children.length > 0)) return null;

  const rows = item.children.map((child, index) => ({
    depth,
    item: child,
    position: index + 1,
    setSize: item.children.length,
  }));
  leafChildRows.set(item, { depth, rows });
  return rows;
}
