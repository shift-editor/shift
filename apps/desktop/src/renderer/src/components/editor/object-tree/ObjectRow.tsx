import { Collapsible, CollapsibleChevron, CollapsibleTrigger } from "@shift/ui";
import { SidebarActionRow } from "@/components/sidebar";
import type { ObjectRowProps, ObjectTreeIcon } from "@/types/objectTree";
import { useEditor } from "@/workspace/WorkspaceContext";
import AnchorIcon from "@/assets/sidebar-left/anchor.svg";
import ComponentIcon from "@/assets/sidebar-left/component.svg";
import ContourIcon from "@/assets/sidebar-left/contour.svg";
import CurvePointIcon from "@/assets/sidebar-left/curve-point.svg";
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
          isSelected={isSelected}
          joinsPrevious={joinsPrevious}
          joinsNext={joinsNext}
          onClick={(event) =>
            selectObject(
              item.id,
              event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "single",
            )
          }
          onKeyDown={async (event) => {
            if (event.key !== "Backspace" && event.key !== "Delete") return;

            event.preventDefault();
            event.stopPropagation();
            try {
              await editor.deleteSelection();
            } catch (error) {
              console.error("object row deletion failed", error);
            }
          }}
          data-testid={`object-${item.id}`}
          contentClassName="pl-1.5"
        >
          <span className="truncate">{item.label}</span>
        </SidebarActionRow>
      </Collapsible>
    </ObjectContextMenu>
  );
};

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
    case "handle":
      return <HandlePointIcon aria-hidden className={className} />;
    case "line":
      return <LinePointIcon aria-hidden className={className} />;
  }
}
