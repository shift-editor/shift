import { useState } from "react";
import { CollapsibleSection } from "@/components/sidebar";
import { AxesPanel } from "./AxesPanel";
import { CreateAxisMenu } from "./CreateAxisMenu";
import { DisplayAxesPanel } from "./DisplayAxesPanel";
import { useFontSession } from "@/workspace/WorkspaceContext";

interface AxesSectionProps {
  defaultOpen?: boolean;
}

export const AxesSection = ({ defaultOpen = false }: AxesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [axisMenuOpen, setAxisMenuOpen] = useState(false);
  const workspace = useFontSession().workspace;

  return (
    <CollapsibleSection
      title="Axes"
      open={open || axisMenuOpen}
      onOpenChange={setOpen}
      isActive={axisMenuOpen}
      actions={workspace ? <CreateAxisMenu onOpenChange={setAxisMenuOpen} /> : null}
    >
      {workspace ? <AxesPanel /> : <DisplayAxesPanel />}
    </CollapsibleSection>
  );
};
