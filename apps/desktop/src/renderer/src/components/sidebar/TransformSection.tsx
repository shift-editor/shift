import { Button } from "@shift/ui";
import { SidebarSection } from "./SidebarSection";
import { SidebarInput } from "./SidebarInput";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";
import { getEditor } from "@/store/store";
import RotateIcon from "@/assets/sidebar/rotate.svg";
import RotateCwIcon from "@/assets/sidebar/rotate-cw.svg";
import FlipHIcon from "@/assets/sidebar/flip-h.svg";
import FlipVIcon from "@/assets/sidebar/flip-v.svg";

export const TransformSection = () => {
  const editor = getEditor();
  const { x, y, hasSelection } = useSelectionBounds();

  const handleRotate90 = () => {
    editor.rotateSelection(Math.PI / 2);
    editor.requestRedraw();
  };

  const handleFlipH = () => {
    editor.reflectSelection("horizontal");
    editor.requestRedraw();
  };

  const handleFlipV = () => {
    editor.reflectSelection("vertical");
    editor.requestRedraw();
  };

  return (
    <SidebarSection title="Transform">
      <div className="flex flex-col gap-2">
        <div className="text-[8px] text-muted uppercase tracking-wide">
          Position
        </div>
        <div className="flex gap-2">
          <SidebarInput label="X" value={hasSelection ? x : "-"} />
          <SidebarInput label="Y" value={hasSelection ? y : "-"} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[8px] text-muted uppercase tracking-wide">
          Rotation
        </div>
        <div className="flex gap-2 items-center">
          <SidebarInput
            label=""
            value={hasSelection ? "0" : "-"}
            icon={<RotateIcon className="w-3 h-3" />}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5"
            onClick={handleRotate90}
            disabled={!hasSelection}
          >
            <RotateCwIcon className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5"
            onClick={handleFlipH}
            disabled={!hasSelection}
          >
            <FlipHIcon className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0.5"
            onClick={handleFlipV}
            disabled={!hasSelection}
          >
            <FlipVIcon className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </SidebarSection>
  );
};
