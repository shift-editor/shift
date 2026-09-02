import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { CreateInstanceMenu } from "./CreateInstanceMenu";
import { Instances } from "./Instances";
import { useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";

interface InstancesSectionProps {
  defaultOpen?: boolean;
}

export const InstancesSection = ({ defaultOpen = false }: InstancesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [instanceMenuOpen, setInstanceMenuOpen] = useState(false);
  const canAuthor = useFontSession().mode === "authored";

  return (
    <CollapsibleSection
      title="Instances"
      open={open || instanceMenuOpen}
      onOpenChange={setOpen}
      isActive={instanceMenuOpen}
      actions={
        canAuthor ? (
          <CreateInstanceMenu onOpenChange={setInstanceMenuOpen} />
        ) : (
          <Tooltip>
            <TooltipTrigger>
              <SidebarActionButton label="Create instance" data-read-only-mutation>
                <PlusIcon className="h-3 w-3" />
              </SidebarActionButton>
            </TooltipTrigger>
            <TooltipContent>Create instance</TooltipContent>
          </Tooltip>
        )
      }
    >
      <Instances canAuthor={canAuthor} />
    </CollapsibleSection>
  );
};
