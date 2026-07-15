import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";

export const LeftSidebar = () => (
  <aside className="h-full w-full min-w-0 bg-panel border-r border-line-subtle flex flex-col overflow-hidden">
    <div className="px-1 py-3 flex flex-col gap-2">
      <SourcesSection defaultOpen />
      <Separator />
      <AxesSection defaultOpen />
    </div>
  </aside>
);
