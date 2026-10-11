import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleTrigger,
  RotateCcw,
  RotateCw,
  Tooltip,
} from "@shift/ui";
import { SidebarActionButton, SidebarActionRow } from "@/components/sidebar";
import { isContourId } from "@shift/types";
import { listSelectionMode } from "@/hooks/useListSelection";
import { reverseContours } from "@/lib/commands/rendererCommands";
import type { ContourDirection, ObjectRowProps, ObjectTreeIcon } from "@/types/objectTree";
import { useEditor } from "@/workspace/WorkspaceContext";
import AnchorIcon from "@/assets/sidebar-left/anchor.svg";
import ComponentIcon from "@/assets/sidebar-left/component.svg";
import ContourIcon from "@/assets/sidebar-left/contour.svg";
import CurvePointIcon from "@/assets/sidebar-left/curve-point.svg";
import FirstPointIcon from "@/assets/sidebar-left/first-point.svg";
import HandlePointIcon from "@/assets/sidebar-left/handle-point.svg";
import LinePointIcon from "@/assets/sidebar-left/line-point.svg";
import { ObjectContextMenu } from "./ObjectContextMenu";

export const ObjectRow = ({
  isCollapsed,
  isSelected,
  joinsNext,
  joinsPrevious,
  onOpenChange,
  row,
  selectObject,
}: ObjectRowProps) => {
  const editor = useEditor();
  const { depth, item } = row;
  const hasChildren = item.children.length > 0;
  const reversibleContourId = item.direction && isContourId(item.id) ? item.id : null;

  return (
    <ObjectContextMenu
      selectObject={() => {
        if (!editor.selection.has(item.id)) selectObject(item.id, "single");
      }}
    >
      <Collapsible
        open={hasChildren ? !isCollapsed : true}
        onOpenChange={hasChildren ? (open) => onOpenChange(item.id, open) : undefined}
        className="contents"
      >
        <SidebarActionRow
          leading={
            <div className="flex h-7 shrink-0 items-center">
              {Array.from({ length: depth }, (_, index) => (
                <span
                  key={index}
                  aria-hidden
                  className="-my-0.5 flex h-8 w-6 shrink-0 justify-end pr-0.75"
                >
                  <span className="h-full border-l border-line-subtle" />
                </span>
              ))}
              {hasChildren ? (
                <CollapsibleTrigger
                  aria-label={`Toggle ${item.label}`}
                  tabIndex={-1}
                  className="flex h-7 w-3 shrink-0 cursor-pointer items-center justify-center text-secondary hover:text-primary"
                >
                  <CollapsibleChevron aria-hidden />
                </CollapsibleTrigger>
              ) : (
                <span aria-hidden className="h-7 w-3 shrink-0" />
              )}
              <span className="ml-1 flex h-3 w-3 shrink-0 items-center justify-center">
                {itemIcon(item.icon, item.iconPath)}
              </span>
            </div>
          }
          actions={
            item.direction &&
            reversibleContourId && (
              <Tooltip content="Reverse contour">
                <SidebarActionButton
                  label={`Reverse ${item.label}`}
                  tabIndex={-1}
                  className={isSelected ? "!opacity-100" : undefined}
                  onClick={() => reverseContours(editor, [reversibleContourId])}
                >
                  <DirectionIcon direction={item.direction} />
                </SidebarActionButton>
              </Tooltip>
            )
          }
          className="pr-2"
          isSelected={isSelected}
          joinsPrevious={joinsPrevious}
          joinsNext={joinsNext}
          onClick={(event) => selectObject(item.id, listSelectionMode(event))}
          data-testid={`object-${item.id}`}
          tabIndex={-1}
          contentClassName="pl-1.5"
        >
          <span className="truncate">{item.label}</span>
        </SidebarActionRow>
      </Collapsible>
    </ObjectContextMenu>
  );
};

const DirectionIcon = ({ direction }: { direction: ContourDirection }) => (
  <span aria-hidden className="flex text-secondary">
    {direction === "clockwise" ? (
      <RotateCw className="h-3.5 w-3.5" />
    ) : (
      <RotateCcw className="h-3.5 w-3.5" />
    )}
  </span>
);

function itemIcon(icon: ObjectTreeIcon, iconPath?: string) {
  const className = "h-3 w-3 text-icon-subtle [&_path]:stroke-current";

  if (icon === "contour" && iconPath) {
    return (
      <svg
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-icon-subtle"
        viewBox="0 0 14 14"
        fill="none"
      >
        <path
          d={iconPath}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  switch (icon) {
    case "anchor":
      return <AnchorIcon aria-hidden className={className} />;
    case "component":
      return <ComponentIcon aria-hidden className={className} />;
    case "contour":
      return <ContourIcon aria-hidden className={className} />;
    case "curve":
      return <CurvePointIcon aria-hidden className={className} />;
    case "first":
      return <FirstPointIcon aria-hidden className="h-3 w-3 text-icon-subtle" />;
    case "handle":
      return <HandlePointIcon aria-hidden className={className} />;
    case "line":
      return <LinePointIcon aria-hidden className={className} />;
  }
}
