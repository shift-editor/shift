import type { NamedInstance } from "@shift/types";
import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
} from "@shift/ui";
import VerticalEllipsis from "@/assets/general/vertical-ellipsis.svg";
import { SidebarActionRow } from "@/components/sidebar";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { useNamedInstances } from "@/hooks/useNamedInstances";
import { axisLocationFromLocation } from "@/lib/variation/location";
import { useEditor } from "@/workspace/WorkspaceContext";

export const Instances = () => {
  const editor = useEditor();
  const instances = useNamedInstances();
  const settings = useSettingsNavigation();

  if (instances.length === 0) {
    return <p className="pl-2 text-ui text-muted">No instances defined</p>;
  }

  const previewInstance = async (instance: NamedInstance) => {
    try {
      const mapped = await editor.font.mapLocation(instance.location);
      editor.setDesignLocation(axisLocationFromLocation(mapped));
    } catch (cause) {
      console.error("Unable to preview named instance", cause);
    }
  };

  return (
    <div className="flex flex-col items-start justify-start gap-1">
      {instances.map((instance) => (
        <SidebarActionRow
          key={instance.id}
          onClick={async () => {
            await previewInstance(instance);
          }}
          contentClassName="h-6 text-ui"
          actions={
            <InstanceActionsMenu
              instanceName={instance.name}
              onEdit={() =>
                settings.open({
                  category: "instances",
                  instanceId: instance.id,
                })
              }
              onDelete={() => editor.font.deleteNamedInstance(instance.id)}
            />
          }
        >
          <span className="truncate">{instance.name}</span>
        </SidebarActionRow>
      ))}
    </div>
  );
};

interface InstanceActionsMenuProps {
  instanceName: string;
  onEdit: () => void;
  onDelete: () => void;
}

const InstanceActionsMenu = ({ instanceName, onEdit, onDelete }: InstanceActionsMenuProps) => (
  <Menu modal={false}>
    <MenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 p-0.5"
          aria-label={`Actions for ${instanceName}`}
        />
      }
    >
      <VerticalEllipsis className="h-5 w-5" />
    </MenuTrigger>
    <MenuPortal>
      <MenuPositioner sideOffset={4} align="end">
        <MenuPopup>
          <MenuItem onClick={onEdit}>Edit</MenuItem>
          <MenuSeparator />
          <MenuItem variant="danger" onClick={onDelete}>
            Delete instance
          </MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
);
