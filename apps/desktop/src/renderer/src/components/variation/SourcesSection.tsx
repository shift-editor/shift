import { useState } from "react";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { CreateSourceMenu } from "./CreateSourceMenu";
import { Sources } from "./Sources";
import { useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";

interface SourcesSectionProps {
  defaultOpen?: boolean;
}

export const SourcesSection = ({ defaultOpen = false }: SourcesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const canAuthor = useFontSession().mode === "authored";

  return (
    <CollapsibleSection
      title="Sources"
      open={open || sourceMenuOpen}
      onOpenChange={setOpen}
      isActive={sourceMenuOpen}
      actions={
        canAuthor ? (
          <CreateSourceMenu onOpenChange={setSourceMenuOpen} />
        ) : (
          <SidebarActionButton label="Create source" data-read-only-mutation>
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        )
      }
    >
      <Sources canAuthor={canAuthor} />
    </CollapsibleSection>
  );
};
