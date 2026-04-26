import { Separator } from "@shift/ui";
import { AxesPanel } from "@/components/variation/AxesPanel";
import { GlyphCatalog } from "./glyph-catalog";

export const LeftSidebar = () => (
  <aside className="flex h-full w-[260px] flex-col border-r border-line-subtle bg-panel">
    <Separator />
    <GlyphCatalog />
    <Separator />
    <AxesPanel />
  </aside>
);
