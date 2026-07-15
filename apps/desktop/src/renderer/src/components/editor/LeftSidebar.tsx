import { useState } from "react";
import { Separator } from "@shift/ui";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { AxesPanel } from "@/components/variation/AxesPanel";
import { CreateAxisMenu } from "@/components/variation/CreateAxisMenu";
import { CreateSourceDialog } from "@/components/variation/CreateSourceDialog";
import { Sources } from "@/components/variation/Sources";

import PlusIcon from "@/assets/plus.svg";

export const LeftSidebar = () => {
  const [createSourceOpen, setCreateSourceOpen] = useState(false);

  return (
    <aside className="h-full w-full min-w-0 bg-panel border-r border-line-subtle flex flex-col overflow-hidden">
      <div className="px-1 py-3 flex flex-col gap-2">
        <CollapsibleSection
          title="Sources"
          defaultOpen
          actions={
            <SidebarActionButton label="Create source" onClick={() => setCreateSourceOpen(true)}>
              <PlusIcon className="w-3 h-3" />
            </SidebarActionButton>
          }
        >
          <Sources />
        </CollapsibleSection>
        <Separator />
        <CollapsibleSection title="Axes" defaultOpen actions={<CreateAxisMenu />}>
          <AxesPanel />
        </CollapsibleSection>
      </div>
      <CreateSourceDialog open={createSourceOpen} onOpenChange={setCreateSourceOpen} />
    </aside>
  );
};
