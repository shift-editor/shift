import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuTrigger,
} from "@shift/ui";
import { getShiftHost } from "@/host/shiftHost";
import type { ObjectContextMenuProps } from "@/types/contextMenu";

export const ObjectContextMenu = ({ children, selectObject }: ObjectContextMenuProps) => (
  <ContextMenu>
    <ContextMenuTrigger className="contents" onContextMenu={selectObject}>
      {children}
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuPositioner>
        <ContextMenuPopup>
          <ContextMenuItem
            onClick={async () => {
              try {
                await getShiftHost().commands.run("edit.deleteSelection");
              } catch (error) {
                console.error("object context-menu deletion failed", error);
              }
            }}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenuPositioner>
    </ContextMenuPortal>
  </ContextMenu>
);
