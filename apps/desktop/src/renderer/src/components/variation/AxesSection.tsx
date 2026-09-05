import { useState } from "react";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { AxesPanel } from "./AxesPanel";
import { CreateAxisMenu } from "./CreateAxisMenu";
import { useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";

interface AxesSectionProps {
  defaultOpen?: boolean;
}

export const AxesSection = ({ defaultOpen = false }: AxesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [axisMenuOpen, setAxisMenuOpen] = useState(false);
  const canAuthor = useFontSession().mode === "authored";

  return (
    <CollapsibleSection
      title="Axes"
      open={open || axisMenuOpen}
      onOpenChange={setOpen}
      isActive={axisMenuOpen}
      actions={
        canAuthor ? (
          <CreateAxisMenu onOpenChange={setAxisMenuOpen} />
        ) : (
          <SidebarActionButton label="Create axis" disabled>
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        )
      }
    >
      <AxesPanel />
    </CollapsibleSection>
  );
};
