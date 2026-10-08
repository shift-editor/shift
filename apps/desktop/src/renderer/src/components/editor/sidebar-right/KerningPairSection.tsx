import { useSignalState } from "@shift/editor/signals";
import { KerningTool, type KerningPair } from "@shift/editor/tools";
import type { GlyphId, Source, SourceId } from "@shift/types";
import { cn } from "@shift/ui";
import { LockIcon } from "@/components/icons/LockIcon";
import { LockOpenIcon } from "@/components/icons/LockOpenIcon";
import { useEditor } from "@/workspace/WorkspaceContext";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { IconButton } from "./IconButton";
import { SidebarSection } from "./SidebarSection";

/**
 * The Kerning tool's current pair: each side's glyph and group with its
 * exception toggle, the kern at the active source, and the kern at every source.
 */
export const KerningPairSection = () => {
  const editor = useEditor();
  useSignalState(editor.toolCell);
  const kerning = useSignalState(editor.font.kerningCell);
  const activeSourceId = useSignalState(editor.activeSourceIdCell);
  const sources = useSignalState(editor.font.sourcesCell);

  const tool = editor.toolManager.activeTool;
  const pair = tool instanceof KerningTool ? tool.currentPair : null;
  if (!pair) {
    return (
      <SidebarSection title="Pair">
        <p className="text-ui text-muted">Click between two glyphs to select a pair.</p>
      </SidebarSection>
    );
  }

  const edited = pair.editablePair(editor);
  const name = (glyphId: GlyphId) => editor.font.entryForId(glyphId)?.name ?? glyphId;

  return (
    <SidebarSection title="Pair">
      {(["first", "second"] as const).map((position) => {
        const glyphId = position === "first" ? pair.first : pair.second;
        const group = kerning.groupOf(position, glyphId);
        const lock = pair.lock(editor, position);
        const exception = lock.locked && lock.toggleable;
        return (
          <div key={position} className="flex items-center gap-2">
            <span className="w-10 truncate text-ui font-medium text-primary">{name(glyphId)}</span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-ui",
                exception ? "text-muted line-through" : "text-secondary",
              )}
            >
              {group ? `@${group}` : "No group"}
            </span>
            <IconButton
              ariaLabel={exception ? "Kern with its group" : "Kern as an exception"}
              icon={lock.locked ? LockIcon : LockOpenIcon}
              disabled={!lock.toggleable}
              onClick={() => pair.toggleLock(editor, position)}
            />
          </div>
        );
      })}
      <EditableSidebarInput
        key={`${pair.gap.left.itemId}:${pair.gap.right.itemId}:${activeSourceId}`}
        ariaLabel="Kerning"
        label="Kern"
        value={edited?.amount ?? Math.round(pair.amount)}
        disabled={!edited}
        onValueChange={(amount) => pair.set(editor, amount)}
      />
      {sources.length > 1 ? (
        <MasterKerning pair={pair} activeSourceId={activeSourceId} sources={sources} />
      ) : null}
    </SidebarSection>
  );
};

interface MasterKerningProps {
  readonly pair: KerningPair;
  readonly activeSourceId: SourceId | null;
  readonly sources: readonly Source[];
}

/** The pair's kern at every source that authors kerning; the active one is emphasised. */
const MasterKerning = ({ pair, activeSourceId, sources }: MasterKerningProps) => {
  const editor = useEditor();
  const kerning = editor.font.kerningCell.peek();
  const kerned = sources.filter((source) => kerning.authors(source.id));
  if (kerned.length === 0) return null;

  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 text-ui">
      {kerned.map((source) => {
        const active = source.id === activeSourceId;
        return (
          <div key={source.id} className="contents">
            <dt className={cn("truncate", active ? "text-primary" : "text-muted")}>
              {source.name}
            </dt>
            <dd className={cn("tabular-nums", active ? "text-primary" : "text-secondary")}>
              {kerning.valueAtSource(source.id, pair.first, pair.second)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};
