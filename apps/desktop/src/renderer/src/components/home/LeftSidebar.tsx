import { useState } from "react";
import { Separator } from "@shift/ui";
import PlusIcon from "@/assets/plus.svg";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { AxesPanel } from "@/components/variation/AxesPanel";
import { CreateAxisMenu } from "@/components/variation/CreateAxisMenu";
import { CreateSourceDialog } from "@/components/variation/CreateSourceDialog";
import { Sources } from "@/components/variation/Sources";
import { GlyphCatalog } from "./glyph-catalog";

export const LeftSidebar = () => {
  const [createSourceOpen, setCreateSourceOpen] = useState(false);

  return (
    <aside className="flex h-full w-full min-w-0 gap-3 flex-col bg-panel px-3 overflow-hidden border-r border-line-subtle">
      <Separator />
      <GlyphCatalog />
      <Separator className="-mx-3 w-auto" />
      <CollapsibleSection
        title="Sources"
        actions={
          <SidebarActionButton label="Create source" onClick={() => setCreateSourceOpen(true)}>
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        }
      >
        <Sources />
      </CollapsibleSection>
      <Separator className="-mx-3 w-auto" />
      <CollapsibleSection title="Axes" actions={<CreateAxisMenu />}>
        <AxesPanel />
      </CollapsibleSection>
      <CreateSourceDialog open={createSourceOpen} onOpenChange={setCreateSourceOpen} />
    </aside>
  );
};
