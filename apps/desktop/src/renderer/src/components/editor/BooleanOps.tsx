import { IconButton } from "./sidebar-right/IconButton";
import { SidebarSection } from "./sidebar-right/SidebarSection";

import UnionIcon from "@/assets/sidebar-right/union.svg";
import IntersectIcon from "@/assets/sidebar-right/intersect.svg";
import SubtractIcon from "@/assets/sidebar-right/subtract.svg";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/signals";
import { getShiftHost } from "@/host/shiftHost";
import { applyBooleanSelection, selectedBooleanContourIds } from "@/lib/editor/sidebarActions";
import { formatSidebarShortcut, sidebarShortcuts } from "@/lib/keyboard/sidebarShortcuts";

export const BooleanOps = () => {
  const editor = useEditor();
  useSignalState(editor.selection.stateCell);
  const selectedContourIds = selectedBooleanContourIds(editor);
  if (!selectedContourIds) return null;

  const isMac = getShiftHost().platform === "darwin";
  const editable = editor.layerForGeometry({ contours: selectedContourIds }) !== null;

  return (
    <SidebarSection title="Boolean">
      <div className="flex gap-2">
        <IconButton
          ariaLabel="Union contours"
          shortcut={formatSidebarShortcut(sidebarShortcuts["boolean.union"], isMac)}
          icon={UnionIcon}
          disabled={!editable}
          onClick={async () => {
            await applyBooleanSelection(editor, "union");
          }}
        />
        <IconButton
          ariaLabel="Intersect contours"
          shortcut={formatSidebarShortcut(sidebarShortcuts["boolean.intersect"], isMac)}
          icon={IntersectIcon}
          disabled={!editable}
          onClick={async () => {
            await applyBooleanSelection(editor, "intersect");
          }}
        />
        <IconButton
          ariaLabel="Subtract contours"
          shortcut={formatSidebarShortcut(sidebarShortcuts["boolean.subtract"], isMac)}
          icon={SubtractIcon}
          disabled={!editable}
          onClick={async () => {
            await applyBooleanSelection(editor, "subtract");
          }}
        />
      </div>
    </SidebarSection>
  );
};
