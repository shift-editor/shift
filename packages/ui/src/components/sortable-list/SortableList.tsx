import * as React from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** How far, in pixels, a press moves before it becomes a drag rather than a click. */
const DRAG_DISTANCE = 4;

/** Space picks an item up and drops it; Enter stays free to activate it, Escape cancels. */
const KEYBOARD_CODES = { start: ["Space"], end: ["Space"], cancel: ["Escape"] };

export interface SortableListProps {
  /** The items' ids, in list order. */
  ids: readonly string[];
  /** Which way the list runs, so arrow keys and the drop gaps follow it. */
  orientation: "vertical" | "horizontal";
  /** Moves an item to `index`, its position among the items after the move. */
  onMove: (id: string, index: number) => void;
  /** Names an item in screen-reader announcements, such as a page's name. */
  itemLabel: (id: string) => string;
  children: React.ReactNode;
}

/**
 * A list whose items reorder by dragging or from the keyboard.
 *
 * @remarks
 * Wraps dnd-kit. A press that moves a few pixels drags an item; a press that
 * does not stays a click. From the keyboard, Space on a focused item picks it
 * up, the arrow keys move it, Space drops it and Escape puts it back. Screen
 * readers hear each step, naming the item with `itemLabel`. Each item is a
 * {@link SortableItem} child (or a component using {@link useSortableItem}).
 */
export function SortableList({ ids, orientation, onMove, itemLabel, children }: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: KEYBOARD_CODES,
    }),
  );
  const items = React.useMemo(() => [...ids], [ids]);
  const announcements = React.useMemo(
    () => listAnnouncements(items, itemLabel),
    [items, itemLabel],
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const to = items.indexOf(String(over.id));
    if (to >= 0) onMove(String(active.id), to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To move this item, press Space. Use the arrow keys to move it, Space to drop it, or Escape to put it back.",
        },
      }}
    >
      <SortableContext
        items={items}
        strategy={
          orientation === "vertical" ? verticalListSortingStrategy : horizontalListSortingStrategy
        }
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** What a sortable item spreads on its elements: its frame, and the control that drags it. */
export interface SortableItemHandle {
  /** For the element that moves while dragging. */
  readonly itemRef: (element: HTMLElement | null) => void;
  readonly itemStyle: React.CSSProperties;
  /**
   * For the focusable control that starts a drag, such as a tab or a row's
   * button: its ref, ARIA description and listeners. It keeps its own role.
   */
  readonly activator: SortableActivatorProps;
  /** Whether this item is the one being dragged. */
  readonly dragging: boolean;
}

/** The props a sortable item's drag control takes. */
export type SortableActivatorProps = React.HTMLAttributes<HTMLElement> & {
  readonly ref: (element: HTMLElement | null) => void;
};

/**
 * One item of a {@link SortableList}, for an item that renders its own elements.
 *
 * @param id - the item's id in the list's `ids`.
 * @param disabled - true while the item must not move, such as while it is renamed.
 */
export function useSortableItem(id: string, disabled = false): SortableItemHandle {
  const sortable = useSortable({ id, disabled });
  // The activator is already a focusable control (a tab, a row's button) with its own role.
  const { role: _role, tabIndex: _tabIndex, ...attributes } = sortable.attributes;

  return {
    itemRef: sortable.setNodeRef,
    itemStyle: {
      transform: CSS.Translate.toString(sortable.transform),
      transition: sortable.transition,
    },
    activator: {
      ...attributes,
      ...sortable.listeners,
      ref: sortable.setActivatorNodeRef,
    },
    dragging: sortable.isDragging,
  };
}

export interface SortableItemProps extends Omit<
  React.ComponentProps<"div">,
  "children" | "ref" | "style"
> {
  id: string;
  disabled?: boolean;
  /** Renders the item; spread `activator` on the control that drags it. */
  children: (handle: SortableItemHandle) => React.ReactNode;
}

/** One item of a {@link SortableList}: a frame that moves while dragged, around `children`. */
export function SortableItem({ id, disabled = false, children, ...props }: SortableItemProps) {
  const handle = useSortableItem(id, disabled);

  return (
    <div ref={handle.itemRef} style={handle.itemStyle} data-dragging={handle.dragging} {...props}>
      {children(handle)}
    </div>
  );
}

function listAnnouncements(
  ids: readonly string[],
  itemLabel: (id: string) => string,
): Announcements {
  const label = (id: UniqueIdentifier) => itemLabel(String(id));
  const position = (id: UniqueIdentifier) => `${ids.indexOf(String(id)) + 1} of ${ids.length}`;

  return {
    onDragStart: ({ active }) => `Picked up ${label(active.id)}, position ${position(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${label(active.id)} moved to position ${position(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${label(active.id)} dropped at position ${position(over.id)}.`
        : `${label(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${label(active.id)} was cancelled.`,
  };
}
