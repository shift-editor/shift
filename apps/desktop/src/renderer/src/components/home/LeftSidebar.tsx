import { Separator } from "@shift/ui";
import { AxesPanel } from "@/components/variation/AxesPanel";
import { GlyphCatalog } from "./glyph-catalog";

import { Sources } from "../variation/Sources";
import { CollapsibleSection } from "../sidebar";

export const LeftSidebar = () => (
  <aside className="flex h-full w-full min-w-0 gap-3 flex-col bg-panel px-3 overflow-hidden border-r border-line-subtle">
    <Separator />
    <GlyphCatalog />
    <Separator className="-mx-3 w-auto" />
    <CollapsibleSection title="Sources">
      <Sources />
    </CollapsibleSection>
    <Separator className="-mx-3 w-auto" />
    <CollapsibleSection title="Axes">
      <AxesPanel />
    </CollapsibleSection>
  </aside>
);
