import {
  Layers,
  LayoutGrid,
  ScrollArea,
  Separator,
  Tabs,
  TabsIndicator,
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
  readonly value: string;
  readonly label: string;
  /** The accessible name, where the label alone would clash with another control. */
  readonly ariaLabel?: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { value: "layers", label: "Layers", Icon: Layers },
  // The export panel's variable-font mark: the designspace is the font's masters and the space between.
  { value: "designspace", label: "Designspace", Icon: VariableIcon },
  // Named apart from the window's own Glyphs tab, which shows the font overview.
  { value: "glyphs", label: "Glyphs", ariaLabel: "Glyphs list", Icon: LayoutGrid },
];

const TAB_CLASS =
  "flex h-5 w-8 flex-none items-center justify-center rounded-sm px-2 text-ui data-[active]:w-auto data-[active]:flex-1 data-[active]:bg-surface data-[active]:font-medium data-[active]:shadow-sm";

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
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-2 mt-2 h-6 shrink-0 gap-0 rounded-md border-0 bg-input p-0.5">
          {VIEWS.map(({ value, label, ariaLabel, Icon }) => {
            const open = value === tab;
            const viewTab = (
              <TabsTab
                key={value}
                value={value}
                aria-label={ariaLabel ?? label}
                className={TAB_CLASS}
              >
                <span className="flex items-center gap-1.5">
                  <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  {open ? <span>{label}</span> : null}
                </span>
              </TabsTab>
            );
            // A view showing only its icon names itself in a tooltip.
            return open ? (
              viewTab
            ) : (
              <Tooltip key={value} content={label}>
                {viewTab}
              </Tooltip>
            );
          })}
          <TabsIndicator className="hidden" />
        </TabsList>
        <Separator className="mt-2 shrink-0" />
        <TabsPanel
          value="layers"
          keepMounted
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="shrink-0 px-1 pt-2">
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
      </Tabs>
    </aside>
  );
};
