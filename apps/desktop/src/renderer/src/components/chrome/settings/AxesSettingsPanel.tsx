import { useEffect, useState } from "react";
import type { Axis, AxisId } from "@shift/types";
import { Button, Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab, cn } from "@shift/ui";
import PlusIcon from "@/assets/plus.svg";
import { useAxes } from "@/hooks/useAxes";
import { AxisDefinitionPanel } from "./AxisDefinitionPanel";
import { AxisMappingPanel } from "./AxisMappingPanel";
import { AxisStylesPanel } from "./AxisStylesPanel";
import type { AxisSettingsSection } from "./types";
import { useAxisDraft } from "./useAxisDraft";

interface AxesSettingsPanelProps {
  onCreateAxis: () => void;
}

export const AxesSettingsPanel = ({ onCreateAxis }: AxesSettingsPanelProps) => {
  const axes = useAxes();
  const [selectedAxisId, setSelectedAxisId] = useState<AxisId | null>(axes[0]?.id ?? null);

  useEffect(() => {
    if (selectedAxisId && axes.some((axis) => axis.id === selectedAxisId)) return;
    setSelectedAxisId(axes[0]?.id ?? null);
  }, [axes, selectedAxisId]);

  const selectedAxis = axes.find((axis) => axis.id === selectedAxisId) ?? null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[9.5rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-line-subtle bg-panel">
        <div className="flex h-11 items-center justify-between border-b border-line-subtle px-2.5">
          <h2 className="text-xs font-medium text-primary">Axes</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Create axis"
            onClick={onCreateAxis}
          >
            <PlusIcon className="h-3 w-3" />
          </Button>
        </div>

        <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-2">
          {axes.map((axis) => (
            <Button
              key={axis.id}
              type="button"
              variant="ghost"
              size="sm"
              isActive={axis.id === selectedAxisId}
              className={cn(
                "h-7 w-full justify-start rounded-sm px-2 text-xs font-normal",
                axis.id === selectedAxisId && "bg-hover/70",
              )}
              onClick={() => setSelectedAxisId(axis.id)}
            >
              {axis.name}
            </Button>
          ))}
          {axes.length === 0 && (
            <p className="px-2 py-3 text-xs text-secondary">No axes defined.</p>
          )}
        </nav>
      </aside>

      {selectedAxis ? (
        <AxisEditor key={selectedAxis.id} axis={selectedAxis} />
      ) : (
        <div className="flex items-center justify-center text-xs text-secondary">
          Create an axis to edit its definition, mapping, and styles.
        </div>
      )}
    </div>
  );
};

const AxisEditor = ({ axis }: { axis: Axis }) => {
  const [section, setSection] = useState<AxisSettingsSection>("definition");
  const draft = useAxisDraft(axis);

  return (
    <Tabs
      value={section}
      onValueChange={(value) => setSection(value as AxisSettingsSection)}
      className="flex min-h-0 min-w-0 flex-col"
    >
      <header className="flex h-11 shrink-0 items-end border-b border-line-subtle px-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate pb-1 text-xs font-medium text-primary">{draft.axis.name}</h2>
          <TabsList className="h-6 self-start border-0">
            <TabsTab value="definition" className="h-6 px-0 pr-5 text-xs">
              Definition
            </TabsTab>
            <TabsTab value="mapping" className="h-6 px-0 pr-5 text-xs">
              Mapping
            </TabsTab>
            <TabsTab value="styles" className="h-6 px-0 text-xs">
              Styles
            </TabsTab>
            <TabsIndicator />
          </TabsList>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <TabsPanel value="definition">
          <AxisDefinitionPanel draft={draft} />
        </TabsPanel>
        <TabsPanel value="mapping">
          <AxisMappingPanel axis={draft.axis} />
        </TabsPanel>
        <TabsPanel value="styles">
          <AxisStylesPanel draft={draft} />
        </TabsPanel>
      </div>
    </Tabs>
  );
};
