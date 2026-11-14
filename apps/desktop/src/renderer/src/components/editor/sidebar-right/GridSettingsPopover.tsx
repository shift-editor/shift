import type { ReactNode, RefObject } from "react";
import {
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  Tooltip,
  X,
} from "@shift/ui";
import { useSignalState } from "@shift/editor/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarNumberField } from "./SidebarNumberField";

interface GridSettingsPopoverProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The zoom menu's trigger; the panel opens beside the sidebar it sits in. */
  readonly trigger: RefObject<HTMLElement | null>;
}

/**
 * The canvas grid's spacing and subdivisions, opened from the zoom menu's Grid settings item.
 *
 * @remarks
 * Showing the grid and snapping to it are toggled in the zoom menu itself.
 * Spacing is in font units from the glyph origin. The settings last for the
 * session; they are not saved with the font.
 */
export const GridSettingsPopover = ({ open, onOpenChange, trigger }: GridSettingsPopoverProps) => {
  const editor = useEditor();
  const grid = useSignalState(editor.grid.settingsCell);

  return (
    <Popover modal={false} open={open} onOpenChange={onOpenChange}>
      <PopoverPortal>
        <PopoverPositioner
          anchor={() => trigger.current?.closest("aside") ?? null}
          side="left"
          align="start"
          sideOffset={-1}
        >
          <PopoverPopup className="flex w-56 flex-col p-0">
            <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pl-2 pr-1">
              <PopoverTitle>Grid</PopoverTitle>
              <Tooltip content="Close">
                <PopoverClose variant="icon" aria-label="Close">
                  <X className="h-4 w-4" />
                </PopoverClose>
              </Tooltip>
            </div>
            <div className="flex flex-col gap-2 p-2">
              <GridRow label="Spacing">
                <div className="flex w-32 gap-1">
                  <SidebarNumberField
                    ariaLabel="Horizontal grid spacing"
                    label="X"
                    value={grid.spacingX}
                    onValueCommit={(spacingX) => editor.grid.update({ spacingX })}
                  />
                  <SidebarNumberField
                    ariaLabel="Vertical grid spacing"
                    label="Y"
                    value={grid.spacingY}
                    onValueCommit={(spacingY) => editor.grid.update({ spacingY })}
                  />
                </div>
              </GridRow>
              <GridRow label="Subdivisions">
                <div className="w-16">
                  <SidebarNumberField
                    ariaLabel="Grid subdivisions"
                    value={grid.subdivisions}
                    onValueCommit={(subdivisions) => editor.grid.update({ subdivisions })}
                  />
                </div>
              </GridRow>
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};

interface GridRowProps {
  readonly label: string;
  readonly children: ReactNode;
}

/** One labelled setting in the grid panel: its name on the left, its controls on the right. */
function GridRow({ label, children }: GridRowProps) {
  return (
    <div className="flex h-6 items-center justify-between gap-2">
      <span className="text-ui text-secondary">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
