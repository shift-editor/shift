import { Button } from "@shift/ui";
import { SidebarSection } from "./SidebarSection";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";
import { getEditor } from "@/store/store";
import type { AlignmentType, DistributeType } from "@/types/transform";

export const AlignmentSection = () => {
  const editor = getEditor();
  const { hasSelection, pointCount } = useSelectionBounds();

  const handleAlign = (alignment: AlignmentType) => {
    editor.alignSelection(alignment);
    editor.requestRedraw();
  };

  const handleDistribute = (type: DistributeType) => {
    editor.distributeSelection(type);
    editor.requestRedraw();
  };

  const canDistribute = hasSelection && pointCount >= 3;

  return (
    <SidebarSection title="Align">
      <div className="flex flex-col gap-2">
        <div className="text-[8px] text-muted uppercase tracking-wide">
          Align
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleAlign("left")}
            disabled={!hasSelection}
            title="Align Left"
          >
            L
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleAlign("center-h")}
            disabled={!hasSelection}
            title="Align Center Horizontal"
          >
            H
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleAlign("right")}
            disabled={!hasSelection}
            title="Align Right"
          >
            R
          </Button>
          <div className="w-px bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleAlign("top")}
            disabled={!hasSelection}
            title="Align Top"
          >
            T
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleAlign("center-v")}
            disabled={!hasSelection}
            title="Align Center Vertical"
          >
            V
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleAlign("bottom")}
            disabled={!hasSelection}
            title="Align Bottom"
          >
            B
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[8px] text-muted uppercase tracking-wide">
          Distribute
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleDistribute("horizontal")}
            disabled={!canDistribute}
            title="Distribute Horizontal"
          >
            DH
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5 text-[10px]"
            onClick={() => handleDistribute("vertical")}
            disabled={!canDistribute}
            title="Distribute Vertical"
          >
            DV
          </Button>
        </div>
      </div>
    </SidebarSection>
  );
};
