import { useState } from "react";
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
  const workspace = useFontSession().workspace;

  return (
    <CollapsibleSection
      title="Instances"
      open={open || instanceMenuOpen}
      onOpenChange={setOpen}
      isActive={instanceMenuOpen}
      actions={
        workspace ? (
          <CreateInstanceMenu onOpenChange={setInstanceMenuOpen} />
        ) : (
          <SidebarActionButton label="Create instance" data-read-only-mutation>
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        )
      }
    >
      {workspace ? <Instances /> : <p className="text-ui text-muted pl-2">No instances defined</p>}
    </CollapsibleSection>
  );
};
