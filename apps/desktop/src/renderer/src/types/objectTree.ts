import type { ListSelectionMode } from "@shift/editor/types";
import type { SelectableId } from "@shift/types";

export type ObjectTreeIcon =
  | "anchor"
  | "component"
  | "contour"
  | "curve"
  | "first"
  | "handle"
  | "line";
export type ContourDirection = "clockwise" | "counterclockwise";
export type ObjectTreeItemKind = "anchor" | "component" | "contour" | "point";
export type ObjectTreeSectionId = "anchors" | "components" | "contours";

export interface ObjectTreeItem {
  readonly children: readonly ObjectTreeItem[];
  /** Winding of a closed contour in font units (y-up); absent for open contours. */
  readonly direction?: ContourDirection;
  readonly icon: ObjectTreeIcon;
  readonly iconPath?: string;
  readonly id: SelectableId;
  readonly kind: ObjectTreeItemKind;
  readonly label: string;
}

export interface ObjectTreeSection {
  readonly id: ObjectTreeSectionId;
  readonly items: readonly ObjectTreeItem[];
  readonly label: string;
}

export type ObjectTree = readonly ObjectTreeSection[];

export interface VisibleObjectRow {
  readonly depth: number;
  readonly item: ObjectTreeItem;
  readonly position: number;
  readonly setSize: number;
}

export type ObjectTreeSelectionHandler = (id: SelectableId, mode: ListSelectionMode) => void;

export interface VirtualObjectRowsProps {
  readonly rows: readonly VisibleObjectRow[];
  readonly visibleIds: readonly SelectableId[];
  readonly selectedIds: ReadonlySet<SelectableId>;
  /** Selected ids plus the children of selected parents. */
  readonly coveredIds: ReadonlySet<SelectableId>;
  readonly collapsedObjectIds: ReadonlySet<SelectableId>;
  readonly setObjectOpen: (id: SelectableId, open: boolean) => void;
  readonly selectObject: ObjectTreeSelectionHandler;
  readonly sectionLabel: string;
  readonly sectionTop: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly focusedObjectId: SelectableId | null;
  readonly pendingFocusId: SelectableId | null;
  readonly onFocusObject: (id: SelectableId) => void;
  readonly onNavigate: (id: SelectableId) => void;
  readonly onPendingFocusResolved: () => void;
  readonly onDeleteSelection: () => Promise<boolean>;
}

export interface ObjectRowProps {
  readonly isCollapsed: boolean;
  readonly isSelected: boolean;
  readonly joinsNext: boolean;
  readonly joinsPrevious: boolean;
  readonly onOpenChange: (id: SelectableId, open: boolean) => void;
  readonly row: VisibleObjectRow;
  readonly selectObject: ObjectTreeSelectionHandler;
}
