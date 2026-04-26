import { IconButton } from "./sidebar-right/IconButton";
import { SidebarSection } from "./sidebar-right/SidebarSection";

import UnionIcon from "@/assets/sidebar-right/union.svg";
import IntersectIcon from "@/assets/sidebar-right/intersect.svg";
import SubtractIcon from "@/assets/sidebar-right/subtract.svg";
import { getEditor } from "@/store/store";

export const BooleanOps = () => {
  const editor = getEditor();
  const selectedContourIds = editor.selection.contourIds;

  if (selectedContourIds.size < 2) return null;
  const [contourIdA, contourIdB] = selectedContourIds;

  return (
    <SidebarSection title="Boolean">
      <div className="flex gap-2">
        <IconButton
          icon={UnionIcon}
          onClick={() => {
            editor.applyBooleanOp(contourIdA, contourIdB, "union");
          }}
        />
        <IconButton
          icon={IntersectIcon}
          onClick={() => {
            editor.applyBooleanOp(contourIdA, contourIdB, "intersect");
          }}
        />
        <IconButton
          icon={SubtractIcon}
          onClick={() => {
            editor.applyBooleanOp(contourIdA, contourIdB, "subtract");
          }}
        />
      </div>
    </SidebarSection>
  );
};
