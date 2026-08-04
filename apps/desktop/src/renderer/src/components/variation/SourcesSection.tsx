import { useState } from "react";
import { CollapsibleSection } from "@/components/sidebar";
import { CreateSourceMenu } from "./CreateSourceMenu";
import { Sources } from "./Sources";
import { useSignalState } from "@/lib/signals";
import { useFontSession } from "@/workspace/WorkspaceContext";

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
      actions={workspace ? <CreateSourceMenu onOpenChange={setSourceMenuOpen} /> : null}
    >
      {workspace ? <Sources /> : <DisplaySource />}
    </CollapsibleSection>
  );
};

const DisplaySource = () => {
  const styleName = useSignalState(useFontSession().catalog.styleNameCell) ?? "Default";

  return <p className="text-ui text-secondary pl-2">{styleName}</p>;
};
