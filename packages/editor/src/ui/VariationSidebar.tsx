import type { SourceId } from "@shift/types";
import { Separator } from "@shift/ui";
import { useState, type ReactNode } from "react";
import { useSignalState } from "../lib/signals";
import { externalAxisLocationFromLocation } from "../lib/variation/location";
import type { EditorUISession } from "./types";
import { AxesPanel } from "./AxesPanel";
import { CollapsibleSection } from "./CollapsibleSection";
import { SidebarActionRow } from "./SidebarActionRow";

/** Application content for one variation sidebar section. */
export interface VariationSidebarSectionHost {
  /** Replaces the section's default list. */
  content: ReactNode;
  /** Buttons shown in the section header. */
  actions?: ReactNode;
  /** Keeps the section open and highlighted, for example while one of its menus is open. */
  active?: boolean;
}

/** Per-section overrides; sections left out keep their default read-only content. */
export interface VariationSidebarHost {
  sources?: VariationSidebarSectionHost;
  instances?: VariationSidebarSectionHost;
  axes?: VariationSidebarSectionHost;
}

export interface VariationSidebarProps {
  session: EditorUISession;
  host?: VariationSidebarHost;
}

/**
 * Renders the Sources, Instances, and Axes sections for the session's font.
 *
 * @remarks
 * By default, choosing a source makes it active and moves every placed glyph
 * to it, choosing an instance moves the editor to its location, and the axes
 * section edits the editor's location.
 */
export function VariationSidebar({ session, host }: VariationSidebarProps) {
  const { editor, font } = session;
  const sources = useSignalState(font.sourcesCell);
  const instances = useSignalState(font.namedInstancesCell);
  const activeSourceId = useSignalState(editor.activeSourceIdCell);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [instancesOpen, setInstancesOpen] = useState(true);
  const [axesOpen, setAxesOpen] = useState(true);

  const selectSource = (sourceId: SourceId) => {
    editor.selectSource(sourceId);
    for (const node of editor.scene.nodesOfKind("glyph")) {
      editor.scene.updateNode({ id: node.id, sourceId });
    }
  };

  return (
    <aside
      aria-label="Variation controls"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden border-r border-line-subtle bg-surface"
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
