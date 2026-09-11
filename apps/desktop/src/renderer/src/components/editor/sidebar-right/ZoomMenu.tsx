import {
  Button,
  ChevronDown,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
} from "@shift/ui";
import { getShiftHost } from "@/host/shiftHost";
import { useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";

export const ZoomMenu = () => {
  const editor = useEditor();
  const zoom = useSignalState(editor.zoomCell);
  const selection = useSignalState(editor.selection.stateCell);

  const isMac = getShiftHost().platform === "darwin";
  const primaryModifier = isMac ? "⌘" : "Ctrl+";
  const shiftModifier = isMac ? "⇧" : "Shift+";

  const onZoomToFit = () => editor.zoomToFit();
  const onZoomToSelection = () => editor.zoomToSelection();
  const onZoomIn = () => editor.zoomIn();
  const onZoomOut = () => editor.zoomOut();
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Zoom options, ${Math.round(zoom * 100)}%`}
            className="h-5 shrink-0 gap-1 px-1 text-ui font-medium text-primary data-[popup-open]:bg-hover/50"
          />
        }
      >
        {Math.round(zoom * 100)}%
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
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};
