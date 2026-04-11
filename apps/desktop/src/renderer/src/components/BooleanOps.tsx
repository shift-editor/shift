import { IconButton } from "./sidebar-right/IconButton";
import { SidebarSection } from "./sidebar-right/SidebarSection";

import UnionIcon from "@/assets/sidebar-right/union.svg";
import IntersectIcon from "@/assets/sidebar-right/intersect.svg";
import SubtractIcon from "@/assets/sidebar-right/subtract.svg";
import { getEditor } from "@/store/store";
import { Glyphs } from "@shift/font";
import { ContourId } from "@shift/types";
import { useSignalState } from "@/lib/reactive/useSignal";

export const BooleanOps = () => {
  const editor = getEditor();
  const glyph = useSignalState(editor.glyph);
  if (!glyph) return null;

  const selectedContourIds = new Set<ContourId>();
  for (const pointId of editor.selectedPointIds.value) {
    const found = Glyphs.findPoint(glyph, pointId);
    if (found) selectedContourIds.add(found.contour.id);
  }

  const selectedContourIdsArray = Array.from(selectedContourIds);
  if (selectedContourIdsArray.length < 2) return null;
  const [contourIdA, contourIdB] = selectedContourIdsArray;

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
