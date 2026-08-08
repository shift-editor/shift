import { IconButton } from "./sidebar-right/IconButton";
import { SidebarSection } from "./sidebar-right/SidebarSection";

import UnionIcon from "@/assets/sidebar-right/union.svg";
import IntersectIcon from "@/assets/sidebar-right/intersect.svg";
import SubtractIcon from "@/assets/sidebar-right/subtract.svg";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@/lib/signals";
import { isContourId } from "@shift/types";

export const BooleanOps = () => {
  const editor = useEditor();
  const selection = useSignalState(editor.selection.stateCell);
  const selectedContourIds = selection.ids.filter(isContourId);

  if (selectedContourIds.length < 2) return null;
  const [contourIdA, contourIdB] = selectedContourIds;
  if (!contourIdA || !contourIdB) return null;

  const editable = editor.layerForGeometry({ contours: selectedContourIds }) !== null;

  return (
    <SidebarSection title="Boolean">
      <div className="flex gap-2">
        <IconButton
          icon={UnionIcon}
          disabled={!editable}
          onClick={() => {
            editor.boolean(contourIdA, contourIdB, "union");
          }}
        />
        <IconButton
          icon={IntersectIcon}
          disabled={!editable}
          onClick={() => {
            editor.boolean(contourIdA, contourIdB, "intersect");
          }}
        />
        <IconButton
          icon={SubtractIcon}
          disabled={!editable}
          onClick={() => {
            editor.boolean(contourIdA, contourIdB, "subtract");
          }}
        />
      </div>
    </SidebarSection>
  );
};
