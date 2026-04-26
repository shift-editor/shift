import { Separator } from "@shift/ui";
import { CollapsibleSection } from "@/components/sidebar";
import { AxesPanel } from "@/components/variation/AxesPanel";
import { Sources } from "@/components/variation/Sources";

export const LeftSidebar = () => (
  <aside className="w-[250px] h-full bg-panel border-l border-line-subtle flex flex-col">
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
