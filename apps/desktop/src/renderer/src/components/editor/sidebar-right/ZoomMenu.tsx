import { useRef, useState } from "react";
import {
  Button,
  Check,
  ChevronDown,
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
} from "@shift/ui";
import { getShiftHost } from "@/host/shiftHost";
import { useSignalState } from "@shift/editor/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import { commandShortcuts } from "@shared/commands";
import { commandShortcutLabel } from "@/lib/keyboard/commandShortcutLabel";
import { GridSettingsPopover } from "./GridSettingsPopover";

export const ZoomMenu = () => {
  const editor = useEditor();
  const zoom = useSignalState(editor.zoomCell);
  const selection = useSignalState(editor.selection.stateCell, { schedule: "frame" });
  const grid = useSignalState(editor.grid.settingsCell);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [gridSettingsOpen, setGridSettingsOpen] = useState(false);

  const isMac = getShiftHost().platform === "darwin";
  const primaryModifier = isMac ? "⌘" : "Ctrl+";
  const shiftModifier = isMac ? "⇧" : "Shift+";

  const onZoomToFit = () => editor.zoomToFit();
  const onZoomToSelection = () => editor.zoomToSelection();
  const onZoomIn = () => editor.zoomIn();
  const onZoomOut = () => editor.zoomOut();
  const showGridShortcut = commandShortcutLabel(commandShortcuts["view.toggleGrid"], isMac);
  const snapShortcut = commandShortcutLabel(commandShortcuts["view.toggleSnapToGrid"], isMac);
  const gridSpacing = `${grid.spacingX} × ${grid.spacingY}`;
  const gridSummary = grid.subdivisions > 1 ? `${gridSpacing} ÷ ${grid.subdivisions}` : gridSpacing;

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              ref={triggerRef}
              variant="ghost"
              size="sm"
              aria-label={`Zoom options, ${Math.round(zoom * 100)}%`}
              className="h-5 shrink-0 gap-1 px-1 text-ui font-medium text-primary data-[popup-open]:bg-hover/50"
            />
          }
        >
          <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
          <ChevronDown aria-hidden className="h-3 w-3" />
        </MenuTrigger>
        <MenuPortal>
          <MenuPositioner side="bottom" align="end" sideOffset={6}>
            <MenuPopup aria-label="Zoom options" className="min-w-52">
              <MenuItem onClick={onZoomIn} className="justify-between gap-6">
                <span>Zoom in</span>
                <kbd className="font-sans text-sm text-muted">{primaryModifier}+</kbd>
              </MenuItem>
              <MenuItem onClick={onZoomOut} className="justify-between gap-6">
                <span>Zoom out</span>
                <kbd className="font-sans text-sm text-muted">{primaryModifier}−</kbd>
              </MenuItem>
              <MenuItem onClick={onZoomToFit} className="justify-between gap-6">
                <span>Zoom to fit</span>
                <kbd className="font-sans text-sm text-muted">{shiftModifier}1</kbd>
              </MenuItem>
              <MenuItem
                onClick={onZoomToSelection}
                disabled={selection.ids.length === 0}
                className="justify-between gap-6"
              >
                <span>Zoom to selection</span>
                <kbd className="font-sans text-sm text-muted">{shiftModifier}2</kbd>
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => editor.setZoom(0.5)}>Zoom to 50%</MenuItem>
              <MenuItem onClick={() => editor.setZoom(1)} className="justify-between gap-6">
                <span>Zoom to 100%</span>
                <kbd className="font-sans text-sm text-muted">{shiftModifier}0</kbd>
              </MenuItem>
              <MenuItem onClick={() => editor.setZoom(2)}>Zoom to 200%</MenuItem>
              <MenuSeparator />
              <MenuCheckboxItem
                checked={grid.visible}
                onCheckedChange={(visible) => editor.grid.update({ visible })}
                className="justify-between"
              >
                <GridItemLabel>Show grid</GridItemLabel>
                <kbd className="font-sans text-sm text-muted">{showGridShortcut}</kbd>
              </MenuCheckboxItem>
              <MenuCheckboxItem
                checked={grid.snap}
                onCheckedChange={(snap) => editor.grid.update({ snap })}
                className="justify-between"
              >
                <GridItemLabel>Snap to grid</GridItemLabel>
                <kbd className="font-sans text-sm text-muted">{snapShortcut}</kbd>
              </MenuCheckboxItem>
              <MenuItem onClick={() => setGridSettingsOpen(true)} className="justify-between gap-6">
                <span className="pl-5">Grid settings…</span>
                <span className="tabular-nums text-secondary">{gridSummary}</span>
              </MenuItem>
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </Menu>
      <GridSettingsPopover
        open={gridSettingsOpen}
        onOpenChange={setGridSettingsOpen}
        trigger={triggerRef}
      />
    </>
  );
};

/** A grid toggle's name, after the tick that shows it is on. */
function GridItemLabel({ children }: { readonly children: string }) {
  return (
    <span className="flex items-center gap-2">
      <MenuCheckboxItemIndicator keepMounted className="w-3 data-[unchecked]:invisible">
        <Check className="h-3 w-3" strokeWidth={1.75} />
      </MenuCheckboxItemIndicator>
      {children}
    </span>
  );
}
