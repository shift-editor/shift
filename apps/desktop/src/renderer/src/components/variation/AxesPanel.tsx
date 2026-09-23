import { AxesPanel as SharedAxesPanel } from "@shift/editor/ui";
import { withExternalAxisValue } from "@shift/editor/variation";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@shift/ui";
import VerticalElipsis from "@/assets/general/vertical-ellipsis.svg";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { useExternalLocation } from "@/hooks/useExternalLocation";
import { useFontSession } from "@/workspace/WorkspaceContext";

export const AxesPanel = () => {
  const session = useFontSession();
  const [location, setExternalLocation] = useExternalLocation();
  const settings = useSettingsNavigation();

  return (
    <SharedAxesPanel
      session={session}
      actions={(axis) =>
        session.mode === "workspace" ? (
          <AxisActionsMenu
            axis={axis}
            onEdit={() => settings.open({ category: "axes", axisId: axis.id })}
            onReset={() => setExternalLocation(withExternalAxisValue(location, axis, axis.default))}
            onDelete={() => session.font.deleteAxis(axis.id)}
          />
        ) : (
          <span />
        )
      }
    />
  );
};

interface AxisActionsMenuProps {
  axis: Axis;
  onEdit: () => void;
  onReset: () => void;
  onDelete: () => void;
}

const AxisActionsMenu = ({ axis, onEdit, onReset, onDelete }: AxisActionsMenuProps) => (
  <Menu modal={false}>
    <Tooltip>
      <TooltipTrigger>
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
      </TooltipTrigger>
      <TooltipContent>{`Actions for ${axis.name}`}</TooltipContent>
    </Tooltip>
    <MenuPortal>
      <MenuPositioner sideOffset={4} align="end">
        <MenuPopup>
          <MenuItem onClick={onEdit}>Edit</MenuItem>
          <MenuItem onClick={onReset}>Reset</MenuItem>
          <MenuSeparator />
          <MenuItem onClick={onDelete}>Delete axis</MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
);
