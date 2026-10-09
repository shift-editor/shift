import { useSignalState } from "@shift/editor/signals";
import { KerningTool, type KerningPair } from "@shift/editor/tools";
import type { KerningPairPosition } from "@shift/editor/model";
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import KerningIcon from "@/assets/toolbar/kerning.svg";
import { LockIcon } from "@/components/icons/LockIcon";
import { LockOpenIcon } from "@/components/icons/LockOpenIcon";
import type { Editor } from "@shift/editor";
import { useEditor } from "@/workspace/WorkspaceContext";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { SidebarSection } from "./SidebarSection";

/**
 * The Kerning tool's selected pair, laid out as property fields: one field
 * per side (glyph, group, exception lock), the kern at the active source,
 * and the kern at every other source that authors kerning.
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

  const pairKey = `${pair.gap.left.itemId}:${pair.gap.right.itemId}`;
  const edited = pair.editablePair(editor);
  // Sources that author kerning, plus the one being edited, which may not yet.
  const kernedSources = sources.filter(
    (source) => kerning.authors(source.id) || source.id === activeSourceId,
  );

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <SidebarSection title="Kerning">
        <div className="flex gap-2">
          <PairSideField editor={editor} pair={pair} position="first" />
          <PairSideField editor={editor} pair={pair} position="second" />
        </div>
        <EditableSidebarInput
          key={`${pairKey}:${activeSourceId}`}
          ariaLabel="Kerning"
          className="pl-8"
          iconPosition="left"
          icon={
            <KerningIcon aria-hidden className="h-5 w-5 text-sidebar-icon" strokeWidth={1.25} />
          }
          value={edited?.amount ?? Math.round(pair.amount)}
          disabled={!edited}
          onValueChange={(amount) => pair.set(editor, amount)}
        />
      </SidebarSection>
      {kernedSources.length > 1 ? (
        <SidebarSection title="Masters">
          {kernedSources.map((source) => {
            const active = source.id === activeSourceId;
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
                <div className="w-16 shrink-0">
                  <EditableSidebarInput
                    key={`${pairKey}:${source.id}`}
                    ariaLabel={`Kerning at ${source.name}`}
                    className="text-right"
                    value={kerning.valueAtSource(source.id, pair.first, pair.second)}
                    disabled={!pair.editablePair(editor, source.id)}
                    onValueChange={(amount) => pair.set(editor, amount, source.id)}
                  />
                </div>
              </div>
            );
          })}
        </SidebarSection>
      ) : null}
    </div>
  );
};

interface PairSideFieldProps {
  readonly editor: Editor;
  readonly pair: KerningPair;
  readonly position: KerningPairPosition;
}

/**
 * One side of the pair as a field: the glyph as its label, the group it
 * kerns through as its value, and a lock that makes it a glyph exception.
 */
const PairSideField = ({ editor, pair, position }: PairSideFieldProps) => {
  const glyphId = position === "first" ? pair.first : pair.second;
  const glyphName = editor.font.entryForId(glyphId)?.name ?? glyphId;
  const kerning = editor.font.kerningCell.peek();
  const groupId = kerning.groupOf(position, glyphId);
  const group = groupId ? (kerning.groups.group(groupId)?.name ?? null) : null;
  const lock = pair.lock(editor, position);
  const exception = lock.locked && lock.toggleable;
  const action = exception ? "Kern with its group" : "Kern as an exception";
  const Icon = lock.locked ? LockIcon : LockOpenIcon;

  return (
    <div className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded bg-input pl-2 pr-0.5 text-ui">
      <span className="max-w-12 shrink-0 truncate font-medium text-muted">{glyphName}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          group && !exception ? "text-primary" : "text-muted",
          exception && "line-through",
        )}
      >
        {group ? `@${group}` : "No group"}
      </span>
      <Tooltip>
        <TooltipTrigger>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={action}
            aria-disabled={!lock.toggleable || undefined}
            className="h-5 w-5 shrink-0 text-sidebar-icon"
            onClick={() => {
              if (lock.toggleable) pair.toggleLock(editor, position);
            }}
          >
            <Icon aria-hidden className="h-full w-full" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{action}</TooltipContent>
      </Tooltip>
    </div>
  );
};
