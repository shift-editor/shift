import { Separator } from "@shift/ui";
import { CollapsibleSection } from "@/components/sidebar";
import { AxesPanel } from "@/components/variation/AxesPanel";
import { Sources } from "@/components/variation/Sources";

export const LeftSidebar = () => (
  <aside className="h-full w-full min-w-0 bg-panel border-r border-line-subtle flex flex-col overflow-hidden">
    <div className="px-1 py-3 flex flex-col gap-2">
      <CollapsibleSection title="Axes" defaultOpen>
        <AxesPanel />
      </CollapsibleSection>
      <Separator />
      <CollapsibleSection title="Sources" defaultOpen>
        <Sources />
      </CollapsibleSection>
    </div>
  </aside>
);
