import type { ReactNode } from "react";
import {
  Button,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
  Switch,
  Tooltip,
  X,
} from "@shift/ui";
import { useSignalState } from "@shift/editor/signals";
import { commandShortcuts } from "@shared/commands";
import GridIcon from "@/assets/general/grid.svg";
import { getShiftHost } from "@/host/shiftHost";
import { commandShortcutLabel } from "@/lib/keyboard/commandShortcutLabel";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarNumberField } from "./SidebarNumberField";

/**
 * The canvas grid's settings, opened from the sidebar header beside the zoom menu.
 *
 * @remarks
 * Spacing is in font units from the glyph origin. The settings last for the
 * session; they are not saved with the font.
 */
export const GridMenu = () => {
  const editor = useEditor();
  const grid = useSignalState(editor.grid.settingsCell);
  const isMac = getShiftHost().platform === "darwin";
  const snapShortcut = commandShortcutLabel(commandShortcuts["view.toggleSnapToGrid"], isMac);
  const active = grid.visible || grid.snap;

  return (
    <Popover modal={false}>
      <Tooltip content="Grid">
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Grid"
              isActive={active}
              className="h-5 w-5 p-0 text-sidebar-icon data-[popup-open]:bg-hover/50"
            />
          }
        >
          <GridIcon aria-hidden className="h-3.5 w-3.5" />
        </PopoverTrigger>
      </Tooltip>
      <PopoverPortal>
        <PopoverPositioner side="bottom" align="end" sideOffset={6}>
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
              <GridRow label="Show grid">
                <Switch
                  aria-label="Show grid"
                  checked={grid.visible}
                  onCheckedChange={(visible) => editor.grid.update({ visible })}
                />
              </GridRow>
              <GridRow label="Snap to grid">
                <kbd className="font-sans text-sm text-muted">{snapShortcut}</kbd>
                <Switch
                  aria-label="Snap to grid"
                  checked={grid.snap}
                  onCheckedChange={(snap) => editor.grid.update({ snap })}
                />
              </GridRow>
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
