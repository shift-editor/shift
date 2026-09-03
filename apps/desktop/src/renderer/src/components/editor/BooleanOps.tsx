import { IconButton } from "./sidebar-right/IconButton";
import { SidebarSection } from "./sidebar-right/SidebarSection";

import UnionIcon from "@/assets/sidebar-right/union.svg";
import IntersectIcon from "@/assets/sidebar-right/intersect.svg";
import SubtractIcon from "@/assets/sidebar-right/subtract.svg";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@/lib/signals";

export const BooleanOps = () => {
  const editor = useEditor();
  const selection = useSignalState(editor.selection.stateCell);
  const selectedIds = new Set(selection.ids);
  const glyphNodes = editor.scene.nodesOfKind("glyph");
  if (glyphNodes.length !== 1) return null;

  const [glyphNode] = glyphNodes;
  if (!glyphNode) return null;

  const layer = editor.glyphForId(glyphNode.glyphId)?.layerForSource(glyphNode.sourceId);
  if (!layer) return null;

  const selectedContourIds = layer.contours
    .filter(
      (contour) =>
        contour.closed &&
        (selectedIds.has(contour.id) || contour.points.every((point) => selectedIds.has(point.id))),
    )
    .map((contour) => contour.id);

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
          onClick={async () => {
            await editor.boolean(contourIdA, contourIdB, "union");
          }}
        />
        <IconButton
          icon={IntersectIcon}
          disabled={!editable}
          onClick={async () => {
            await editor.boolean(contourIdA, contourIdB, "intersect");
          }}
        />
        <IconButton
          icon={SubtractIcon}
          disabled={!editable}
          onClick={async () => {
            await editor.boolean(contourIdA, contourIdB, "subtract");
          }}
        />
      </div>
    </SidebarSection>
  );
};
