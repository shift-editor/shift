import { Separator } from "@shift/ui";
import { useState, type ReactNode } from "react";
import { useSignalState } from "../lib/signals";
import { externalAxisLocationFromLocation } from "../lib/variation/location";
import type { EditorUISession } from "./types";
import { AxesPanel } from "./AxesPanel";
import { CollapsibleSection } from "./CollapsibleSection";
import { SidebarActionRow } from "./SidebarActionRow";

export interface VariationSidebarSectionHost {
  content: ReactNode;
  actions?: ReactNode;
  active?: boolean;
}

export interface VariationSidebarHost {
  sources?: VariationSidebarSectionHost;
  instances?: VariationSidebarSectionHost;
  axes?: VariationSidebarSectionHost;
}

export interface VariationSidebarProps {
  session: EditorUISession;
  host?: VariationSidebarHost;
}

export function VariationSidebar({ session, host }: VariationSidebarProps) {
  const { editor, font } = session;
  const sources = useSignalState(font.sourcesCell);
  const instances = useSignalState(font.namedInstancesCell);
  const activeSourceId = useSignalState(editor.activeSourceIdCell);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [instancesOpen, setInstancesOpen] = useState(true);
  const [axesOpen, setAxesOpen] = useState(true);

  const selectSource = (sourceId: (typeof sources)[number]["id"]) => {
    editor.selectSource(sourceId);
    for (const node of editor.scene.nodesOfKind("glyph")) {
      editor.scene.updateNode({ id: node.id, sourceId });
    }
  };

  return (
    <aside
      aria-label="Variation controls"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden border-r border-line-subtle bg-panel"
    >
      <div className="scrollbar-hidden flex min-h-0 flex-col gap-2 overflow-y-auto px-1 py-3">
        <CollapsibleSection
          title="Sources"
          open={sourcesOpen || Boolean(host?.sources?.active)}
          onOpenChange={setSourcesOpen}
          isActive={host?.sources?.active}
          actions={host?.sources?.actions}
        >
          {host?.sources?.content ?? (
            <div className="flex flex-col items-start justify-start gap-1">
              {sources.map((source) => (
                <SidebarActionRow
                  key={source.id}
                  isActive={source.id === activeSourceId}
                  onClick={() => selectSource(source.id)}
                  contentClassName="h-6 text-ui"
                >
                  <span className="min-w-0 flex-1 truncate text-left">{source.name}</span>
                </SidebarActionRow>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <Separator />

        <CollapsibleSection
          title="Instances"
          open={instancesOpen || Boolean(host?.instances?.active)}
          onOpenChange={setInstancesOpen}
          isActive={host?.instances?.active}
          actions={host?.instances?.actions}
        >
          {host?.instances?.content ?? (
            <div className="flex flex-col items-start justify-start gap-1">
              {instances.map((instance) => (
                <SidebarActionRow
                  key={instance.id}
                  onClick={() =>
                    editor.setExternalLocation(externalAxisLocationFromLocation(instance.location))
                  }
                  contentClassName="h-6 text-ui"
                >
                  <span className="min-w-0 flex-1 truncate text-left">{instance.name}</span>
                </SidebarActionRow>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <Separator />

        <CollapsibleSection
          title="Axes"
          open={axesOpen || Boolean(host?.axes?.active)}
          onOpenChange={setAxesOpen}
          isActive={host?.axes?.active}
          actions={host?.axes?.actions}
        >
          {host?.axes?.content ?? <AxesPanel session={session} />}
        </CollapsibleSection>
      </div>
    </aside>
  );
}
