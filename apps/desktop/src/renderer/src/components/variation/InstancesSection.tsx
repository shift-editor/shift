import { useState } from "react";
import { CollapsibleSection } from "@/components/sidebar";
import { CreateInstanceMenu } from "./CreateInstanceMenu";
import { Instances } from "./Instances";

interface InstancesSectionProps {
  defaultOpen?: boolean;
}

export const InstancesSection = ({ defaultOpen = false }: InstancesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [instanceMenuOpen, setInstanceMenuOpen] = useState(false);

  return (
    <CollapsibleSection
      title="Instances"
      open={open || instanceMenuOpen}
      onOpenChange={setOpen}
      isActive={instanceMenuOpen}
      actions={<CreateInstanceMenu onOpenChange={setInstanceMenuOpen} />}
    >
      <Instances />
    </CollapsibleSection>
  );
};
