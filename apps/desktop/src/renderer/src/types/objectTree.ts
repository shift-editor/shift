import type { ListSelectionMode, SelectableId } from "@shift/editor/types";

export type ObjectTreeIcon = "anchor" | "component" | "contour" | "curve" | "handle" | "line";
export type ObjectTreeItemKind = "anchor" | "component" | "contour" | "point";
export type ObjectTreeSectionId = "anchors" | "components" | "contours";

export interface ObjectTreeItem {
  readonly children: readonly ObjectTreeItem[];
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
}

export type ObjectTreeSelectionHandler = (id: SelectableId, mode: ListSelectionMode) => void;

export interface ObjectRowProps {
  readonly isCollapsed: boolean;
  readonly isSelected: boolean;
  readonly joinsNext: boolean;
  readonly joinsPrevious: boolean;
  readonly onOpenChange: (id: SelectableId, open: boolean) => void;
  readonly row: VisibleObjectRow;
  readonly selectObject: ObjectTreeSelectionHandler;
}
