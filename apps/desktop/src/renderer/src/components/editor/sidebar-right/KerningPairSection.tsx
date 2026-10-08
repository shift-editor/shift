import { useSignalState } from "@shift/editor/signals";
import { KerningTool } from "@shift/editor/tools";
import type { GlyphId } from "@shift/types";
import { cn } from "@shift/ui";
import { LockIcon } from "@/components/icons/LockIcon";
import { LockOpenIcon } from "@/components/icons/LockOpenIcon";
import { useEditor } from "@/workspace/WorkspaceContext";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { IconButton } from "./IconButton";
import { SidebarSection } from "./SidebarSection";

/**
 * The Kerning tool's selected pair: each side's glyph and group with its
 * exception toggle, and the pair's kern at every source, editable in place.
 *
 * @remarks
 * Renders nothing until a pair is selected.
 */
export const KerningPairSection = () => {
  const editor = useEditor();
  useSignalState(editor.toolCell);
  const kerning = useSignalState(editor.font.kerningCell);
  const activeSourceId = useSignalState(editor.activeSourceIdCell);
  const sources = useSignalState(editor.font.sourcesCell);

  const tool = editor.toolManager.activeTool;
  const pair = tool instanceof KerningTool ? tool.currentPair : null;
  if (!pair) return null;

  const name = (glyphId: GlyphId) => editor.font.entryForId(glyphId)?.name ?? glyphId;
  const pairKey = `${pair.gap.left.itemId}:${pair.gap.right.itemId}`;

  const multipleSources = sources.length > 1;

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <SidebarSection title="Kerning">
        <div className="flex flex-col gap-2">
          <div className="text-ui text-secondary">Pair</div>
          <div className="grid grid-cols-2 gap-2">
            {(["first", "second"] as const).map((position) => {
              const glyphId = position === "first" ? pair.first : pair.second;
              const group = kerning.groupOf(position, glyphId);
              const lock = pair.lock(editor, position);
              const exception = lock.locked && lock.toggleable;
              return (
                <div key={position} className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-ui font-medium text-primary">{name(glyphId)}</span>
                  <div className="flex min-w-0 items-center gap-1">
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
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-ui text-secondary">{multipleSources ? "Masters" : "Value"}</div>
          {sources.map((source) => {
            const edited = pair.editablePair(editor, source.id);
            const active = source.id === activeSourceId;
            const input = (
              <EditableSidebarInput
                key={`${pairKey}:${source.id}`}
                ariaLabel={`Kerning at ${source.name}`}
                className={multipleSources ? "w-16 text-right" : undefined}
                value={kerning.valueAtSource(source.id, pair.first, pair.second)}
                disabled={!edited}
                onValueChange={(amount) => pair.set(editor, amount, source.id)}
              />
            );
            if (!multipleSources) return input;
            return (
              <div key={source.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-ui",
                    active ? "font-medium text-primary" : "text-secondary",
                  )}
                >
                  {source.name}
                </span>
                {input}
              </div>
            );
          })}
        </div>
      </SidebarSection>
    </div>
  );
};
