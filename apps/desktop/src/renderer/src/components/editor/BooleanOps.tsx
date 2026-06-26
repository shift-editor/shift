import { IconButton } from "./sidebar-right/IconButton";
import { SidebarSection } from "./sidebar-right/SidebarSection";

import UnionIcon from "@/assets/sidebar-right/union.svg";
import IntersectIcon from "@/assets/sidebar-right/intersect.svg";
import SubtractIcon from "@/assets/sidebar-right/subtract.svg";
import { useEditor } from "@/workspace/WorkspaceContext";

export const BooleanOps = () => {
  const editor = useEditor();
  const selectedContourIds = editor.selection.contourIds;

  if (selectedContourIds.size < 2) return null;
  const [contourIdA, contourIdB] = selectedContourIds;

  return (
    <SidebarSection title="Boolean">
      <div className="flex gap-2">
        <IconButton
          icon={UnionIcon}
          onClick={() => {
            editor.boolean(contourIdA, contourIdB, "union");
          }}
        />
        <IconButton
          icon={IntersectIcon}
          onClick={() => {
            editor.boolean(contourIdA, contourIdB, "intersect");
          }}
        />
        <IconButton
          icon={SubtractIcon}
          onClick={() => {
            editor.boolean(contourIdA, contourIdB, "subtract");
          }}
        />
      </div>
    </SidebarSection>
  );
};
