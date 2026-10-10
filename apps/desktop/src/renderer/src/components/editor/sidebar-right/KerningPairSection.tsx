import { useSignalState } from "@shift/editor/signals";
import { KerningTool, type KerningPair } from "@shift/editor/tools";
import {
  isGroupSide,
  kerningValueEdit,
  type Kerning,
  type KerningPairPosition,
  type KerningSideId,
} from "@shift/editor/model";
import { useRef } from "react";
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import KerningIcon from "@/assets/toolbar/kerning.svg";
import MinusIcon from "@/assets/general/minus.svg";
import { KerningGroupField } from "@/components/kerning/KerningGroupField";
import { KerningGroupsPanel } from "@/components/kerning/groups/KerningGroupsPanel";
import { LockIcon } from "@/components/icons/LockIcon";
import { LockOpenIcon } from "@/components/icons/LockOpenIcon";
import type { Editor } from "@shift/editor";
import type { SourceId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { SidebarSection, SidebarSubsection } from "./SidebarSection";

/**
 * The Kerning tool's selected pair, laid out as property fields: each side's
 * group with its exception lock at the row's outer ends, the kern at the
 * active source, and the kern at every other source that authors kerning.
 *
 * @remarks
 * Renders nothing until a pair is selected.
 */
export const KerningPairSection = () => {
  const editor = useEditor();
  useSignalState(editor.toolCellIf("kerning"));
  const kerning = useSignalState(editor.font.kerningCell);
  const activeSourceId = useSignalState(editor.activeSourceIdCell);
  const sources = useSignalState(editor.font.sourcesCell);
  const sectionRef = useRef<HTMLDivElement>(null);

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
    <div ref={sectionRef} className="flex flex-col gap-4 px-3 py-3">
      <SidebarSection
        title="Kerning"
        actions={
          <KerningGroupsPanel
            target={{ kind: "pair", first: pair.first, second: pair.second }}
            anchorRef={sectionRef}
          />
        }
      >
        <SidebarSubsection title="Groups">
          {/* Each side's exception lock at its outer end, beside the group it breaks from. */}
          <div className="flex items-center gap-1">
            <ExceptionLock editor={editor} pair={pair} position="first" />
            <PairSideField editor={editor} pair={pair} position="first" />
            <PairSideField editor={editor} pair={pair} position="second" />
            <ExceptionLock editor={editor} pair={pair} position="second" />
          </div>
        </SidebarSubsection>
        <SidebarSubsection title="Value">
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
        </SidebarSubsection>
        {kernedSources.length > 1 ? (
          <SidebarSubsection title="Masters">
            {kernedSources.map((source) => (
              <MasterKernRow
                key={`${pairKey}:${source.id}`}
                editor={editor}
                kerning={kerning}
                pair={pair}
                sourceId={source.id}
                sourceName={source.name}
                active={source.id === activeSourceId}
              />
            ))}
          </SidebarSubsection>
        ) : null}
      </SidebarSection>
    </div>
  );
};

interface PairSideFieldProps {
  readonly editor: Editor;
  readonly pair: KerningPair;
  readonly position: KerningPairPosition;
}

/**
 * One side of the pair as a dropdown field: the group its facing edge kerns
 * through. The pair itself is on the canvas, so the field needs no glyph label.
 */
const PairSideField = ({ editor, pair, position }: PairSideFieldProps) => {
  const glyphId = position === "first" ? pair.first : pair.second;
  const glyphName = editor.font.entryForId(glyphId)?.name ?? glyphId;
  const edge = position === "first" ? "right" : "left";

  return (
    <div className="min-w-0 flex-1">
      <KerningGroupField
        position={position}
        glyphId={glyphId}
        glyphName={glyphName}
        ariaLabel={`Kerning group of ${glyphName}'s ${edge} edge`}
        disabled={editor.sessionMode !== "workspace"}
      />
    </div>
  );
};

/** One side's exception lock: closed when that glyph kerns on its own rather than through its group. */
const ExceptionLock = ({ editor, pair, position }: PairSideFieldProps) => {
  const glyphId = position === "first" ? pair.first : pair.second;
  const glyphName = editor.font.entryForId(glyphId)?.name ?? glyphId;
  const lock = pair.lock(editor, position);
  const exception = lock.locked && lock.toggleable;
  const action = exception
    ? `Kern ${glyphName} with its group`
    : `Kern ${glyphName} as an exception`;
  const Icon = lock.locked ? LockIcon : LockOpenIcon;

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={action}
          aria-disabled={!lock.toggleable || undefined}
          className="shrink-0 text-sidebar-icon"
          onClick={() => {
            if (lock.toggleable) pair.toggleLock(editor, position);
          }}
        >
          <Icon aria-hidden className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action}</TooltipContent>
    </Tooltip>
  );
};

interface MasterKernRowProps {
  readonly editor: Editor;
  readonly kerning: Kerning;
  readonly pair: KerningPair;
  readonly sourceId: SourceId;
  readonly sourceName: string;
  readonly active: boolean;
}

/**
 * The pair's kern at one master. Set means a pair applies there (a glyph
 * exception or a group pair) and shows in full beside a remove button; unset
 * means none does, and the greyed value is what the master kerns instead:
 * 0 while it kerns other pairs, else a blend of the other masters, as the
 * compiled font does. Typing a value sets it at that master.
 *
 * @remarks
 * Removing deletes the pair that applies at that master only, so the master
 * falls back to the next more general pair: an exception to its group pair,
 * a group pair to nothing. A group pair's value is shared by every glyph in
 * its groups, so its tooltip names the pair it removes.
 */
const MasterKernRow = ({
  editor,
  kerning,
  pair,
  sourceId,
  sourceName,
  active,
}: MasterKernRowProps) => {
  const applied = kerning.resolve(sourceId, pair.first, pair.second);
  const editable = pair.editablePair(editor, sourceId) !== null;
  // Unset, the master kerns what the compiled font gives it: 0 while it kerns
  // other pairs, else a blend of the other masters.
  const resolved = Math.round(
    editor.font.kerningBetween(pair.first, pair.second, editor.font.defaultLocation(), sourceId),
  );

  return (
    <div className="flex items-center gap-2">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {/* The master being edited: a dot, not a heavier name that reads as a heading. */}
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", active && "bg-accent")}
        />
        <span className={cn("truncate text-ui", active ? "text-primary" : "text-secondary")}>
          {sourceName}
          {active ? <span className="sr-only"> (editing)</span> : null}
        </span>
      </span>
      <div className="w-16 shrink-0">
        <EditableSidebarInput
          ariaLabel={`Kerning at ${sourceName}`}
          className="text-right"
          value={applied?.amount ?? null}
          placeholder={String(resolved)}
          disabled={!editable}
          onValueChange={(amount) => pair.set(editor, amount, sourceId)}
        />
      </div>
      <div className="flex w-6 shrink-0 justify-center">
        {applied && editable ? (
          <Tooltip>
            <TooltipTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove kerning at ${sourceName}`}
                className="text-sidebar-icon"
                onClick={() =>
                  void editor.font.setKerningValues(
                    [kerningValueEdit(sourceId, applied)],
                    "Remove kerning",
                  )
                }
              >
                <MinusIcon aria-hidden className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Remove {sideLabel(editor, kerning, applied.first)} /{" "}
              {sideLabel(editor, kerning, applied.second)} at this master
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
};

/** A pair side as people know it: a group's name, or a glyph's. */
function sideLabel(editor: Editor, kerning: Kerning, side: KerningSideId): string {
  if (isGroupSide(side)) return kerning.groups.group(side)?.name ?? side;
  return editor.font.entryForId(side)?.name ?? side;
}
