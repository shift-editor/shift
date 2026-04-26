import { Separator } from "@shift/ui";
import { GlyphCatalog, type GlyphCatalogProps } from "./glyph-catalog";
import { AxesPanel } from "./AxesPanel";

export type LeftSidebarHomeProps = GlyphCatalogProps;

export const LeftSidebarHome = (props: LeftSidebarHomeProps) => (
  <aside className="flex h-full w-[260px] flex-col border-r border-line-subtle bg-panel">
    <Separator />
    <GlyphCatalog {...props} />
    <Separator />
    <AxesPanel />
  </aside>
);
