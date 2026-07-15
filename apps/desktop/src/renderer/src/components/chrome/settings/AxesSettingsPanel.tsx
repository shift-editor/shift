import { useEffect, useState } from "react";
import type { Axis, AxisId } from "@shift/types";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab, cn } from "@shift/ui";
import MinusIcon from "@/assets/minus.svg";
import { SidebarActionButton, SidebarActionRow } from "@/components/sidebar/SidebarActionRow";
import { CreateAxisMenu } from "@/components/variation/CreateAxisMenu";
import { useAxes } from "@/hooks/useAxes";
import type { AxisSettingsSection } from "@/types/settings";
import { useFont } from "@/workspace/WorkspaceContext";
import { AxisDefinitionPanel } from "./AxisDefinitionPanel";
import { AxisMappingPanel } from "./AxisMappingPanel";
import { AxisStylesPanel } from "./AxisStylesPanel";
import { useAxisDraft } from "./useAxisDraft";

interface AxesSettingsPanelProps {
  initialAxisId?: AxisId;
}

export const AxesSettingsPanel = ({ initialAxisId }: AxesSettingsPanelProps) => {
  const font = useFont();
  const axes = useAxes();
  const [selectedAxisId, setSelectedAxisId] = useState<AxisId | null>(
    initialAxisId ?? axes[0]?.id ?? null,
  );
  const [createdAxisId, setCreatedAxisId] = useState<AxisId | null>(null);

  useEffect(() => {
    if (createdAxisId && axes.some((axis) => axis.id === createdAxisId)) {
      setSelectedAxisId(createdAxisId);
      setCreatedAxisId(null);
      return;
    }

    if (selectedAxisId && axes.some((axis) => axis.id === selectedAxisId)) return;
    setSelectedAxisId(axes[0]?.id ?? null);
  }, [axes, createdAxisId, selectedAxisId]);

  const selectedAxis = axes.find((axis) => axis.id === selectedAxisId) ?? null;

  return (
    <div className="grid h-full flex-1 grid-cols-[10rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-r-toolbar bg-canvas">
        <div className="flex h-11 shrink-0 items-center justify-between px-2">
          <h2 className="pl-1 text-sm font-medium text-primary">Axes</h2>
          <CreateAxisMenu onAxisCreated={setCreatedAxisId} />
        </div>

        <nav className="scrollbar-hidden flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {axes.map((axis) => (
            <SidebarActionRow
              key={axis.id}
              isActive={axis.id === selectedAxisId}
              className={cn(
                "h-8",
                axis.id === selectedAxisId && "bg-hover hover:bg-hover data-[active]:bg-hover",
              )}
              onClick={() => setSelectedAxisId(axis.id)}
              contentClassName="h-8 text-sm font-normal"
              actions={
                <SidebarActionButton
                  label={`Delete ${axis.name}`}
                  className="h-8 hover:bg-icon-button-hover"
                  onClick={(event) => {
                    event.stopPropagation();
                    font.deleteAxis(axis.id);
                  }}
                >
                  <MinusIcon className="h-3 w-3" />
                </SidebarActionButton>
              }
            >
              <span className="truncate">{axis.name}</span>
            </SidebarActionRow>
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
      <header className="shrink-0">
        <div className="flex h-11 items-center px-5 pr-8">
          <h2 className="truncate text-sm font-medium text-primary">{draft.axis.name}</h2>
        </div>
        <TabsList className="h-8 w-full gap-2 border-toolbar px-5 pr-8">
          <TabsTab value="definition" className="h-8 px-2.5 text-sm">
            Definition
          </TabsTab>
          <TabsTab value="mapping" className="h-8 px-2.5 text-sm">
            Mapping
          </TabsTab>
          <TabsTab value="styles" className="h-8 px-2.5 text-sm">
            Styles
          </TabsTab>
          <TabsIndicator />
        </TabsList>
      </header>

      <div className="scrollbar-hidden min-h-0 flex-1 overflow-auto">
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
