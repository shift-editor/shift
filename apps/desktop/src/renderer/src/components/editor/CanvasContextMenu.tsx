import { useCallback } from "react";
import type { CommandId } from "@shared/commands";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@shift/ui";
import { useSignalState } from "@shift/editor/signals";
import { CanvasSurface } from "@shift/editor/rendering";
import { getShiftHost } from "@/host/shiftHost";
import { canMakeFirstPoint } from "@/lib/commands/rendererCommands";
import type { CanvasContextMenuProps } from "@/types/contextMenu";
import { useEditor } from "@/workspace/WorkspaceContext";

export const CanvasContextMenu = ({ children }: CanvasContextMenuProps) => {
  const editor = useEditor();
  useSignalState(editor.selection.stateCell);
  const runCommand = useCallback(async (commandId: CommandId) => {
    try {
      await getShiftHost().commands.run(commandId);
    } catch (error) {
      console.error("canvas context-menu command failed", commandId, error);
    }
  }, []);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="contents"
        onContextMenu={(event) => {
          const interactiveCanvas =
            event.currentTarget.querySelector<HTMLCanvasElement>("#interactive-canvas");
          if (!interactiveCanvas) return;

          const screenPos = CanvasSurface.localPoint(interactiveCanvas, {
            x: event.clientX,
            y: event.clientY,
          });
          editor.updateMousePosition(event.clientX, event.clientY);
          editor.flushMousePosition();

          const target = editor.getPointerTarget(editor.fromScreen(screenPos).scene);
          switch (target.kind) {
            case "point":
            case "anchor":
            case "segment":
            case "component":
              if (!editor.selection.has(target.id)) editor.selection.select([target.id]);
              break;
            case "canvas":
            case "node":
              break;
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuPositioner>
          <ContextMenuPopup>
            <ContextMenuItem onClick={async () => runCommand("edit.cut")}>Cut</ContextMenuItem>
            <ContextMenuItem onClick={async () => runCommand("edit.copy")}>Copy</ContextMenuItem>
            <ContextMenuItem onClick={async () => runCommand("edit.paste")}>Paste</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={async () => runCommand("edit.duplicate")}>
              Duplicate
            </ContextMenuItem>
            <ContextMenuItem onClick={async () => runCommand("edit.deleteSelection")}>
              Delete
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={async () => runCommand("edit.selectAll")}>
              Select All
            </ContextMenuItem>
            <ContextMenuItem onClick={async () => runCommand("edit.deselect")}>
              Deselect
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={async () => runCommand("glyph.addComponent")}>
              Add component…
            </ContextMenuItem>
            <ContextMenuItem onClick={async () => runCommand("glyph.reverseSelectedContour")}>
              Reverse Contour
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!canMakeFirstPoint(editor)}
              onClick={async () => runCommand("glyph.makeFirstPoint")}
            >
              Make First Point
            </ContextMenuItem>
          </ContextMenuPopup>
        </ContextMenuPositioner>
      </ContextMenuPortal>
    </ContextMenu>
  );
};
