import { useState } from "react";
import type { AxisDefinition, AxisId } from "@shift/types";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
  X,
} from "@shift/ui";
import PlusIcon from "@/assets/general/plus.svg";
import { useSidebarPanelAnchor } from "@/hooks/useSidebarPanelAnchor";
import { SidebarActionButton } from "@/components/sidebar";
import { useAxes } from "@/hooks/useAxes";
import { REGISTERED_AXIS_PRESETS, nextCustomAxisDefinition } from "@/lib/variation/axisPresets";
import { useFont } from "@/workspace/WorkspaceContext";

interface CreateAxisMenuProps {
  onAxisCreated?: (axisId: AxisId) => void;
  onOpenChange?: (open: boolean) => void;
}

export const CreateAxisMenu = ({ onAxisCreated, onOpenChange }: CreateAxisMenuProps) => {
  const font = useFont();
  const [open, setOpen] = useState(false);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (onOpenChange) onOpenChange(next);
  };
  const axes = useAxes();
  const existingTags = new Set(axes.map((axis) => axis.tag));
  const availablePresets = REGISTERED_AXIS_PRESETS.filter(
    (preset) => !existingTags.has(preset.tag),
  );

  const createAxis = (definition: AxisDefinition) => {
    const axisId = font.createAxis(definition);
    if (onAxisCreated) onAxisCreated(axisId);
  };

  const panelAnchor = useSidebarPanelAnchor();

  if (availablePresets.length === 0) {
    return (
      <Tooltip content="Create custom axis">
        <SidebarActionButton
          label="Create custom axis"
          onClick={() => createAxis(nextCustomAxisDefinition(axes))}
        >
          <PlusIcon className="h-3 w-3" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return (
    <Menu modal={false} open={open} onOpenChange={changeOpen}>
      <Tooltip content="Create axis">
        <MenuTrigger
          ref={panelAnchor.triggerRef}
          render={
            <SidebarActionButton label="Create axis">
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          }
        />
      </Tooltip>
      <MenuPortal>
        <MenuPositioner {...panelAnchor.positioner}>
          <MenuPopup className="w-50">
            {/* The same title and close as the Create Source and Create Instance popovers. */}
            <div className="-mx-1 -mt-1 mb-1 flex h-8 items-center justify-between border-b border-line-subtle pl-3 pr-1">
              <span className="text-ui font-medium text-primary">Create Axis</span>
              <Tooltip content="Close">
                <button
                  type="button"
                  aria-label="Close"
                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-primary/70 transition-colors hover:bg-hover hover:text-primary"
                  onClick={() => changeOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
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
            <MenuSeparator className="-mx-1 my-1" />
            <MenuItem variant="outlined" onClick={() => createAxis(nextCustomAxisDefinition(axes))}>
              <PlusIcon className="h-3 w-3 text-muted" />
              Add custom axis
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};
