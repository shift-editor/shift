import type { AxisDefinition, AxisId } from "@shift/types";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
} from "@shift/ui";
import PlusIcon from "@/assets/plus.svg";
import { SidebarActionButton } from "@/components/sidebar";
import { useAxes } from "@/hooks/useAxes";
import { REGISTERED_AXIS_PRESETS, nextCustomAxisDefinition } from "@/lib/variation/axisPresets";
import { useFont } from "@/workspace/WorkspaceContext";

interface CreateAxisMenuProps {
  onAxisCreated?: (axisId: AxisId) => void;
}

export const CreateAxisMenu = ({ onAxisCreated }: CreateAxisMenuProps) => {
  const font = useFont();
  const axes = useAxes();
  const existingTags = new Set(axes.map((axis) => axis.tag));
  const availablePresets = REGISTERED_AXIS_PRESETS.filter(
    (preset) => !existingTags.has(preset.tag),
  );

  const createAxis = (definition: AxisDefinition) => {
    const axisId = font.createAxis(definition);
    if (onAxisCreated) onAxisCreated(axisId);
  };

  return (
    <Menu modal={false}>
      <MenuTrigger
        render={
          <SidebarActionButton label="Create axis">
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        }
      />
      <MenuPortal>
        <MenuPositioner sideOffset={4} align="start">
          <MenuPopup className="w-64 p-2">
            {availablePresets.map((preset) => (
              <MenuItem
                key={preset.tag}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-6"
                onClick={() => createAxis(preset)}
              >
                <span className="truncate">{preset.name}</span>
                <span className="font-mono text-secondary">{preset.tag}</span>
              </MenuItem>
            ))}
            {availablePresets.length > 0 && <MenuSeparator className="-mx-2 my-2" />}
            <MenuItem
              className="h-8 justify-center gap-2 border border-line-subtle bg-canvas hover:bg-hover data-[highlighted]:bg-hover"
              onClick={() => createAxis(nextCustomAxisDefinition(axes))}
            >
              <PlusIcon className="h-3 w-3 text-muted" />
              Add custom axis
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};
