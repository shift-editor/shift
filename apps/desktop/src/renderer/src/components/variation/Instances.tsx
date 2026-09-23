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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@shift/ui";
import VerticalEllipsis from "@/assets/general/vertical-ellipsis.svg";
import { SidebarActionButton, SidebarActionRow } from "@/components/sidebar";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { useNamedInstances } from "@/hooks/useNamedInstances";
import { externalAxisLocationFromLocation } from "@shift/editor/variation";
import { useEditor } from "@/workspace/WorkspaceContext";
import { OutlineVisibilityButton } from "./OutlineVisibilityButton";
import type { InstancesProps } from "./types";

export const Instances = ({ canAuthor, outlineControls }: InstancesProps) => {
  const editor = useEditor();
  const instances = useNamedInstances();
  const settings = useSettingsNavigation();

  if (instances.length === 0) {
    return <p className="pl-2 text-ui text-muted">No instances defined</p>;
  }

  const previewInstance = (instance: NamedInstance) => {
    editor.setExternalLocation(externalAxisLocationFromLocation(instance.location));
  };

  return (
    <div className="flex flex-col items-start justify-start gap-1">
      {instances.map((instance) => {
        const target = { kind: "instance", instanceId: instance.id } as const;
        const visible =
          outlineControls?.targets.some(
            (candidate) => candidate.kind === "instance" && candidate.instanceId === instance.id,
          ) ?? false;
        const inherited =
          outlineControls?.inheritedTargets.some(
            (candidate) => candidate.kind === "instance" && candidate.instanceId === instance.id,
          ) ?? false;

        return (
          <SidebarActionRow
            key={instance.id}
            data-testid={`instance-${instance.id}`}
            onClick={() => previewInstance(instance)}
            actions={
              <>
                {outlineControls && (
                  <OutlineVisibilityButton
                    visible={visible}
                    inherited={inherited}
                    label="outline"
                    onClick={() => outlineControls.onToggle(target)}
                  />
                )}
                <InstanceActionsMenu
                  instanceName={instance.name}
                  disabled={!canAuthor}
                  onEdit={() =>
                    settings.open({
                      category: "instances",
                      instanceId: instance.id,
                    })
                  }
                  onDelete={() => editor.font.deleteNamedInstance(instance.id)}
                />
              </>
            }
          >
            <span className="min-w-0 flex-1 truncate text-left">{instance.name}</span>
          </SidebarActionRow>
        );
      })}
    </div>
  );
};

interface InstanceActionsMenuProps {
  instanceName: string;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

const InstanceActionsMenu = ({
  instanceName,
  disabled,
  onEdit,
  onDelete,
}: InstanceActionsMenuProps) => {
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <SidebarActionButton label={`Actions for ${instanceName}`} aria-disabled>
            <VerticalEllipsis className="h-5 w-5" />
          </SidebarActionButton>
        </TooltipTrigger>
        <TooltipContent>Instance actions unavailable in preview mode</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Menu modal={false}>
      <Tooltip>
        <TooltipTrigger>
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
        </TooltipTrigger>
        <TooltipContent>{"Edit instance"}</TooltipContent>
      </Tooltip>
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
};
