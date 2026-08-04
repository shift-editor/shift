import { useState } from "react";
import { Button } from "@shift/ui";
import { CollapsibleSection, SidebarActionButton, SidebarActionRow } from "@/components/sidebar";
import { CreateSourceMenu } from "./CreateSourceMenu";
import { Sources } from "./Sources";
import { useSignalState } from "@/lib/signals";
import { useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";
import VerticalEllipsis from "@/assets/general/vertical-ellipsis.svg";

interface SourcesSectionProps {
  defaultOpen?: boolean;
}

export const SourcesSection = ({ defaultOpen = false }: SourcesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const workspace = useFontSession().workspace;

  return (
    <CollapsibleSection
      title="Sources"
      open={open || sourceMenuOpen}
      onOpenChange={setOpen}
      isActive={sourceMenuOpen}
      actions={
        workspace ? (
          <CreateSourceMenu onOpenChange={setSourceMenuOpen} />
        ) : (
          <SidebarActionButton label="Create source" data-read-only-mutation>
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        )
      }
    >
      {workspace ? <Sources /> : <DisplaySource />}
    </CollapsibleSection>
  );
};

const DisplaySource = () => {
  const styleName = useSignalState(useFontSession().catalog.styleNameCell) ?? "Default";

  return (
    <div className="flex justify-start items-start flex-col gap-1">
      <SidebarActionRow
        isActive
        contentClassName="h-6 text-ui"
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6 p-0.5"
            aria-label={`Actions for ${styleName}`}
            data-read-only-mutation
          >
            <VerticalEllipsis className="h-5 w-5" />
          </Button>
        }
      >
        {styleName}
      </SidebarActionRow>
    </div>
  );
};
