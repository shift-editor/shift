import { useState } from "react";
import { CollapsibleSection } from "@/components/sidebar";
import { CreateInstanceMenu } from "./CreateInstanceMenu";
import { Instances } from "./Instances";
import { useFontSession } from "@/workspace/WorkspaceContext";

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
      actions={workspace ? <CreateInstanceMenu onOpenChange={setInstanceMenuOpen} /> : null}
    >
      {workspace ? <Instances /> : <p className="text-ui text-muted pl-2">No instances defined</p>}
    </CollapsibleSection>
  );
};
