import type { Axis } from "@shift/types";
import { Slider } from "@shift/ui";
import { EditableSidebarInput } from "@/components/editor/sidebar-right/EditableSidebarInput";
import { useAxes } from "@/hooks/useAxes";
import { useVariationLocation } from "@/hooks/useVariationLocation";
import { useApplyVariation } from "@/hooks/useApplyVariation";

export const AxesPanel = () => {
  const axes = useAxes();
  const [location] = useVariationLocation();
  const apply = useApplyVariation();

  if (axes.length === 0) return null;

  const onAxisChange = (tag: string, value: number) => apply({ ...location, [tag]: value });

  return (
    <div className="flex flex-col gap-1">
      {axes.map((axis) => (
        <div key={axis.tag} className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-ui text-secondary">{axis.name}</span>
          </div>

          <div className="flex items-center gap-4">
            <EditableSidebarInput
              value={location[axis.tag] ?? axis.default}
              className="w-14"
              onValueChange={(value) => onAxisChange(axis.tag, value)}
            />
            <AxisSlider
              axis={axis}
              value={location[axis.tag] ?? axis.default}
              onChange={(value) => onAxisChange(axis.tag, value)}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

interface AxisSliderProps {
  axis: Axis;
  value: number;
  onChange: (value: number) => void;
}

const AxisSlider = ({ axis, value, onChange }: AxisSliderProps) => (
  <Slider min={axis.minimum} max={axis.maximum} step={1} value={value} onValueChange={onChange} />
);
