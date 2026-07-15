import { useState } from "react";
import { CollapsibleSection } from "@/components/sidebar";
import { AxesPanel } from "./AxesPanel";
import { CreateAxisMenu } from "./CreateAxisMenu";

interface AxesSectionProps {
  defaultOpen?: boolean;
}

export const AxesSection = ({ defaultOpen = false }: AxesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [axisMenuOpen, setAxisMenuOpen] = useState(false);

  return (
    <CollapsibleSection
      title="Axes"
      open={open || axisMenuOpen}
      onOpenChange={setOpen}
      isActive={axisMenuOpen}
      actions={<CreateAxisMenu onOpenChange={setAxisMenuOpen} />}
    >
      <AxesPanel />
    </CollapsibleSection>
  );
};
