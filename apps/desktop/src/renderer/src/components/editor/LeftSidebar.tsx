import {
  Layers,
  LayoutGrid,
  ScrollArea,
  Separator,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Tooltip,
} from "@shift/ui";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import VariableIcon from "@assets/export/target-variable.svg";
import { SidebarBrand } from "@/components/chrome/SidebarBrand";
import { ExportSection } from "@/components/export/ExportSection";
import { PagesSection } from "@/components/pages/PagesSection";
import { useExport } from "@/context/ExportContext";
import { GlyphsPanel } from "./GlyphsPanel";
import { ObjectSectionRow } from "./object-tree/ObjectSectionRow";
import { ObjectsPanel } from "./ObjectsPanel";
import { VariationPanel } from "./VariationPanel";

/** A view the sidebar switches to: the open one shows its icon and name, the others their icon. */
const VIEWS: readonly {
  readonly id: string;
  readonly label: string;
  /** The accessible name, where the label alone would clash with another control. */
  readonly ariaLabel?: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { id: "layers", label: "Layers", Icon: Layers },
  // The export panel's variable-font mark: the designspace is the font's masters and the space between.
  { id: "designspace", label: "Designspace", Icon: VariableIcon },
  // Named apart from the window's own Glyphs tab, which shows the font overview.
  { id: "glyphs", label: "Glyphs", ariaLabel: "Glyphs list", Icon: LayoutGrid },
];

/**
 * The document's lists: its pages and what the canvas holds, its sources,
 * instances and exports, or its glyphs. Opening the Export popover, such as with ⇧⌘E,
 * shows the Designspace tab, since the popover opens beside its Export section.
 */
export const LeftSidebar = () => {
  const { popoverOpen } = useExport();
  const [tab, setTab] = useState<string>("layers");
  useEffect(() => {
    if (popoverOpen) setTab("designspace");
  }, [popoverOpen]);

  return (
    <aside
      aria-label="Layers, designspace and glyphs"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden border-r border-line-subtle bg-surface"
    >
      <SidebarBrand />
      <Separator className="shrink-0" />
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        orientation="vertical"
        className="flex min-h-0 flex-1 flex-row"
      >
        {/* The rail: one icon per view down the sidebar's edge, each named in a tooltip. */}
        <TabsList variant="rail" className="shrink-0">
          {VIEWS.map(({ id, label, ariaLabel, Icon }) => (
            <Tooltip key={id} content={label}>
              <TabsTab variant="rail" value={id} aria-label={ariaLabel ?? label}>
                <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
              </TabsTab>
            </Tooltip>
          ))}
        </TabsList>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The open view titles itself, since the rail shows only icons. */}
          <h2 className="shrink-0 px-3 pt-2.5 text-ui font-medium text-primary">
            {VIEWS.find((view) => view.id === tab)?.label}
          </h2>
          <TabsPanel
            value="layers"
            keepMounted
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="shrink-0 px-1">
              <PagesSection section={ObjectSectionRow} />
            </div>
            <Separator className="mt-2 shrink-0" />
            <div className="min-h-0 flex-1 overflow-hidden">
              <ObjectsPanel />
            </div>
          </TabsPanel>
          <TabsPanel value="designspace" keepMounted className="min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="px-1 pb-2">
                <VariationPanel />
                <Separator className="-mx-1 my-2 w-auto" />
                <ExportSection />
              </div>
            </ScrollArea>
          </TabsPanel>
          <TabsPanel value="glyphs" className="min-h-0 flex-1 overflow-hidden">
            <GlyphsPanel />
          </TabsPanel>
        </div>
      </Tabs>
    </aside>
  );
};
