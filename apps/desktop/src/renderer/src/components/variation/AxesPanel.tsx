import type { Axis } from "@shift/types";
import { Slider } from "@shift/ui";
import { EditableSidebarInput } from "@/components/editor/sidebar-right/EditableSidebarInput";
import { useAxes } from "@/hooks/useAxes";
import { useDesignLocation } from "@/hooks/useDesignLocation";
import { axisValue, withAxisValue } from "@/lib/variation/location";

export const AxesPanel = () => {
  const axes = useAxes();
  const [location, setDesignLocation] = useDesignLocation();

  if (axes.length === 0)
    return <p className="text-ui text-muted">No axes defined</p>;

  const onAxisChange = (axis: Axis, value: number) => {
    const nextLocation = withAxisValue(location, axis, value);
    setDesignLocation(nextLocation);
  };

  return (
    <div className="flex flex-col gap-1">
      {axes.length > 0 &&
        axes.map((axis) => (
          <div key={axis.tag} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-ui text-secondary">{axis.name}</span>
            </div>

            <div className="flex items-center gap-4">
              <EditableSidebarInput
                value={axisValue(location, axis)}
                className="w-14"
                onValueChange={(value) => onAxisChange(axis, value)}
              />
              <AxisSlider
                axis={axis}
                value={axisValue(location, axis)}
                onChange={(value) => onAxisChange(axis, value)}
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
  <Slider
    min={axis.minimum}
    max={axis.maximum}
    step={1}
    value={value}
    onValueChange={onChange}
  />
);
