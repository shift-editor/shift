import { useState } from "react";
import { CollapsibleSection } from "@/components/sidebar";
import { CreateSourceMenu } from "./CreateSourceMenu";
import { Sources } from "./Sources";

interface SourcesSectionProps {
  defaultOpen?: boolean;
}

export const SourcesSection = ({ defaultOpen = false }: SourcesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);

  return (
    <CollapsibleSection
      title="Sources"
      open={open || sourceMenuOpen}
      onOpenChange={setOpen}
      isActive={sourceMenuOpen}
      actions={<CreateSourceMenu onOpenChange={setSourceMenuOpen} />}
    >
      <Sources />
    </CollapsibleSection>
  );
};
