import { cn } from "@shift/ui";
import { useLayoutEffect, useState } from "react";
import type { SelectableId } from "@shift/editor/types";
import type { VirtualObjectRowsProps } from "@/types/objectTree";
import { ObjectRow } from "./ObjectRow";

export const OBJECT_ROW_STEP = 32;
const ROW_GAP = 4;
const OVERSCAN_ROWS = 6;

export function VirtualObjectRows({
  rows,
  visibleIds,
  selectedIds,
  coveredIds,
  collapsedObjectIds,
  setObjectOpen,
  selectObject,
  sectionLabel,
  sectionTop,
  scrollTop,
  viewportHeight,
  focusedObjectId,
  pendingFocusId,
  onFocusObject,
  onNavigate,
  onPendingFocusResolved,
  onDeleteSelection,
}: VirtualObjectRowsProps) {
  const visibleRowRange = {
    start: Math.min(
      rows.length,
      Math.max(0, Math.floor((scrollTop - sectionTop) / OBJECT_ROW_STEP) - OVERSCAN_ROWS),
    ),
    end: Math.min(
      rows.length,
      Math.max(
        0,
        Math.ceil((scrollTop + viewportHeight - sectionTop) / OBJECT_ROW_STEP) + OVERSCAN_ROWS,
      ),
    ),
  };
  const before = visibleRowRange.start > 0 ? visibleRowRange.start * OBJECT_ROW_STEP - ROW_GAP : 0;
  const afterCount = rows.length - visibleRowRange.end;
  const after = afterCount > 0 ? afterCount * OBJECT_ROW_STEP - ROW_GAP : 0;
  const focusedIndex = focusedObjectId ? visibleIds.indexOf(focusedObjectId) : -1;
  const mountedFocus = focusedIndex >= visibleRowRange.start && focusedIndex < visibleRowRange.end;
  // The tree's own focus ring is suppressed; the focused row shows one only while
  // navigating by keyboard, so modifier keys after a click don't flash a ring.
  const [isKeyboardNavigating, setKeyboardNavigating] = useState(false);

  useLayoutEffect(() => {
    if (!pendingFocusId) return;

    const index = visibleIds.indexOf(pendingFocusId);
    if (index < visibleRowRange.start || index >= visibleRowRange.end) return;

    onFocusObject(pendingFocusId);
    onPendingFocusResolved();
  }, [
    onFocusObject,
    onPendingFocusResolved,
    pendingFocusId,
    visibleIds,
    visibleRowRange.start,
    visibleRowRange.end,
  ]);

  return (
    <div
      role="tree"
      aria-label={sectionLabel}
      aria-multiselectable="true"
      aria-activedescendant={mountedFocus ? `object-tree-${focusedObjectId}` : undefined}
      tabIndex={0}
      className="flex flex-col gap-1 outline-none"
      onPointerDown={() => setKeyboardNavigating(false)}
      onBlur={() => setKeyboardNavigating(false)}
      onFocus={() => {
        if (mountedFocus) return;

        const index = Math.min(
          rows.length - 1,
          Math.max(0, Math.ceil((scrollTop - sectionTop) / OBJECT_ROW_STEP)),
        );
        const item = rows[index]?.item;
        if (item) onFocusObject(item.id);
      }}
      onClickCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const item = target.closest<HTMLElement>('[role="treeitem"]');
        const id = item?.dataset.objectId as SelectableId | undefined;
        if (!id) return;

        onFocusObject(id);
        event.currentTarget.focus({ preventScroll: true });
      }}
      onKeyDown={async (event) => {
        if (rows.length === 0) return;

        const currentIndex = Math.max(0, visibleIds.indexOf(focusedObjectId ?? rows[0]!.item.id));
        const current = rows[currentIndex];
        if (!current) return;

        let next: SelectableId | undefined;
        switch (event.key) {
          case "ArrowDown":
            next = rows[Math.min(rows.length - 1, currentIndex + 1)]?.item.id;
            break;
          case "ArrowUp":
            next = rows[Math.max(0, currentIndex - 1)]?.item.id;
            break;
          case "Home":
            next = rows[0]?.item.id;
            break;
          case "End":
            next = rows.at(-1)?.item.id;
            break;
          case "ArrowRight":
            if (current.item.children.length === 0) break;
            if (collapsedObjectIds.has(current.item.id)) {
              setObjectOpen(current.item.id, true);
              next = current.item.id;
            } else {
              next = rows[currentIndex + 1]?.item.id;
            }
            break;
          case "ArrowLeft":
            if (current.item.children.length > 0 && !collapsedObjectIds.has(current.item.id)) {
              setObjectOpen(current.item.id, false);
              next = current.item.id;
            } else {
              next = rows
                .slice(0, currentIndex)
                .reverse()
                .find((row) => row.depth < current.depth)?.item.id;
            }
            break;
          case "Enter":
            selectObject(current.item.id, "single");
            event.preventDefault();
            return;
          case " ":
            selectObject(current.item.id, "toggle");
            event.preventDefault();
            return;
          case "Backspace":
          case "Delete":
            event.preventDefault();
            try {
              await onDeleteSelection();
            } catch (error) {
              console.error("object row deletion failed", error);
            }
            return;
          default:
            return;
        }

        if (!next) return;
        event.preventDefault();
        setKeyboardNavigating(true);
        onNavigate(next);
      }}
    >
      {before > 0 && <div aria-hidden style={{ height: before }} />}
      {rows.slice(visibleRowRange.start, visibleRowRange.end).map((row, index) => {
        const rowIndex = visibleRowRange.start + index;
        const previousId = visibleIds[rowIndex - 1];
        const nextId = visibleIds[rowIndex + 1];
        const isSelected = selectedIds.has(row.item.id);
        const isCovered = coveredIds.has(row.item.id);

        return (
          <div
            key={row.item.id}
            id={`object-tree-${row.item.id}`}
            role="treeitem"
            data-object-id={row.item.id}
            aria-level={row.depth + 1}
            aria-posinset={row.position}
            aria-setsize={row.setSize}
            aria-selected={isSelected}
            aria-expanded={
              row.item.children.length > 0 ? !collapsedObjectIds.has(row.item.id) : undefined
            }
            className={cn(
              "h-7 rounded",
              isKeyboardNavigating && row.item.id === focusedObjectId && "ring-2 ring-primary/50",
            )}
          >
            <ObjectRow
              row={row}
              isCollapsed={collapsedObjectIds.has(row.item.id)}
              isSelected={isCovered}
              joinsPrevious={isCovered && previousId !== undefined && coveredIds.has(previousId)}
              joinsNext={isCovered && nextId !== undefined && coveredIds.has(nextId)}
              onOpenChange={setObjectOpen}
              selectObject={selectObject}
            />
          </div>
        );
      })}
      {after > 0 && <div aria-hidden style={{ height: after }} />}
    </div>
  );
}
