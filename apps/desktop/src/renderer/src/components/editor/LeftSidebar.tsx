import { useState } from "react";
import { Separator } from "@shift/ui";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { AxesPanel } from "@/components/variation/AxesPanel";
import { CreateAxisDialog } from "@/components/variation/CreateAxisDialog";
import { Sources } from "@/components/variation/Sources";

import PlusIcon from "@/assets/plus.svg";

export const LeftSidebar = () => {
  const [createAxisOpen, setCreateAxisOpen] = useState(false);

  return (
    <aside className="h-full w-full min-w-0 bg-panel border-r border-line-subtle flex flex-col overflow-hidden">
      <div className="px-1 py-3 flex flex-col gap-2">
        <CollapsibleSection
          title="Axes"
          defaultOpen
          actions={
            <SidebarActionButton label="Create axis" onClick={() => setCreateAxisOpen(true)}>
              <PlusIcon className="w-3 h-3" />
            </SidebarActionButton>
          }
        >
          <AxesPanel />
        </CollapsibleSection>
        <Separator />
        <CollapsibleSection title="Sources" defaultOpen>
          <Sources />
        </CollapsibleSection>
      </div>
      <CreateAxisDialog open={createAxisOpen} onOpenChange={setCreateAxisOpen} />
    </aside>
  );
};
