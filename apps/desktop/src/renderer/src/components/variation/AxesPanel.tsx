import type { Axis } from "@shift/types";
import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
  Slider,
} from "@shift/ui";
import { EditableSidebarInput } from "@/components/editor/sidebar-right/EditableSidebarInput";
import { useAxes } from "@/hooks/useAxes";
import { useDesignLocation } from "@/hooks/useDesignLocation";
import { axisValue, withAxisValue } from "@/lib/variation/location";
import { useFont } from "@/workspace/WorkspaceContext";

import VerticalElipsis from "@/assets/vertical-ellipsis.svg";

export const AxesPanel = () => {
  const font = useFont();
  const axes = useAxes();
  const [location, setDesignLocation] = useDesignLocation();

  if (axes.length === 0) return <p className="text-ui text-muted pl-2">No axes defined</p>;

  const onAxisChange = (axis: Axis, value: number) => {
    const nextLocation = withAxisValue(location, axis, value);
    setDesignLocation(nextLocation);
  };

  const resetAxis = (axis: Axis) => {
    onAxisChange(axis, axis.default);
  };

  const deleteAxis = (axis: Axis) => {
    font.deleteAxis(axis.id);
  };

  return (
    <div className="flex flex-col gap-1">
      {axes.length > 0 &&
        axes.map((axis) => (
          <div key={axis.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-2">
              <span className="text-ui text-secondary">{axis.name}</span>
            </div>

            <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_1.5rem] items-center gap-4 pl-2">
              <EditableSidebarInput
                value={axisValue(location, axis)}
                className="w-14"
                onValueChange={(value) => onAxisChange(axis, value)}
              />
              <AxisSlider
                axis={axis}
                value={axisValue(location, axis)}
                onChange={(value) => onAxisChange(axis, value)}
                onReset={() => resetAxis(axis)}
              />
              <AxisActionsMenu
                axis={axis}
                onReset={() => resetAxis(axis)}
                onDelete={() => deleteAxis(axis)}
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
  onReset: () => void;
}

const AxisSlider = ({ axis, value, onChange, onReset }: AxisSliderProps) => (
  <div
    className="min-w-0 flex-1"
    onDoubleClick={(event) => {
      event.preventDefault();
      onReset();
    }}
  >
    <Slider min={axis.minimum} max={axis.maximum} step={1} value={value} onValueChange={onChange} />
  </div>
);

interface AxisActionsMenuProps {
  axis: Axis;
  onReset: () => void;
  onDelete: () => void;
}

const AxisActionsMenu = ({ axis, onReset, onDelete }: AxisActionsMenuProps) => (
  <Menu modal={false}>
    <MenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 p-0.5"
          aria-label={`Actions for ${axis.name}`}
        />
      }
    >
      <VerticalElipsis className="h-5 w-5" />
    </MenuTrigger>
    <MenuPortal>
      <MenuPositioner sideOffset={4} align="end">
        <MenuPopup>
          <MenuItem onClick={onReset}>Reset</MenuItem>
          <MenuSeparator />
          <MenuItem variant="danger" onClick={onDelete}>
            Delete axis
          </MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
);
