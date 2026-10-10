import { useEffect, useState } from "react";
import type { KerningPairPosition } from "@shift/editor/model";
import { useSignalState } from "@shift/editor/signals";
import type { GlyphId, KerningGroupId } from "@shift/types";
import { Button, ChevronDown, Plus, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { TrashIcon } from "@/components/icons/TrashIcon";
import { useEditor } from "@/workspace/WorkspaceContext";
import { AddMembersPanel } from "./AddMembersPanel";
import { GroupPreview } from "./GroupPreview";
import { GroupsSidePanel } from "./GroupsSidePanel";
import { MemberSelection } from "./MemberSelection";
import { glyphName } from "./previewGlyphs";

/** The glyph edge a pair position kerns through: a first glyph's right edge, a second's left. */
const EDGE_LABEL: Readonly<Record<KerningPairPosition, string>> = {
  first: "right edge",
  second: "left edge",
};

const NO_MEMBERS: readonly GlyphId[] = [];

interface GroupViewProps {
  readonly position: KerningPairPosition;
  /** The glyph on this side, whose group is shown first. */
  readonly glyphId: GlyphId;
  /** The pair's other glyph, which the preview sets the members against; null without a pair. */
  readonly otherGlyphId: GlyphId | null;
}

/** A group at one pair position: the glyph's own until another is picked. */
export function GroupView({ position, glyphId, otherGlyphId }: GroupViewProps) {
  const editor = useEditor();
  const kerning = useSignalState(editor.font.kerningCell);
  const [picked, setPicked] = useState<KerningGroupId | null>(null);
  const [sidePanel, setSidePanel] = useState<"groups" | "add" | null>(null);
  const [hovered, setHovered] = useState<GlyphId | null>(null);
  const [selection, setSelection] = useState(() => MemberSelection.empty(NO_MEMBERS));

  const own = kerning.groupOf(position, glyphId);
  const shownId = picked !== null && kerning.groups.group(picked) ? picked : own;
  const shownGroup = shownId ? kerning.groups.group(shownId) : null;
  const shown = shownGroup?.name ?? null;
  const members = shownGroup?.glyphIds ?? NO_MEMBERS;
  // A member removed or moved elsewhere is no longer selected.
  const current = selection.withMembers(members);
  const removeSelected = () => void editor.font.assignKerningGroup(position, current.ids, null);

  // A press anywhere but the preview and its selection row, in or out of the
  // panel, dismisses the member selection.
  const hasSelection = !current.isEmpty;
  useEffect(() => {
    if (!hasSelection) return undefined;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-keeps-member-selection]")
      ) {
        return;
      }
      setSelection((previous) => previous.clear());
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [hasSelection]);

  const toggleSidePanel = (panel: "groups" | "add") =>
    setSidePanel(sidePanel === panel ? null : panel);

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="field"
          size="field"
          isActive={sidePanel === "groups"}
          aria-label={`Kerning group shown, ${EDGE_LABEL[position]}`}
          aria-expanded={sidePanel === "groups"}
          onClick={() => toggleSidePanel("groups")}
        >
          <span className={shown ? "truncate" : "truncate text-muted"}>{shown ?? "No group"}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-muted">
            {shown ? <span className="tabular-nums">{members.length}</span> : null}
            <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
          </span>
        </Button>
        {shown ? (
          <Tooltip>
            <TooltipTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0"
                isActive={sidePanel === "add"}
                aria-label={`Add glyphs to ${shown}`}
                aria-expanded={sidePanel === "add"}
                onClick={() => toggleSidePanel("add")}
              >
                <Plus className="h-4.5 w-4.5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add glyphs</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {sidePanel === "groups" ? (
        <GroupsSidePanel
          position={position}
          shown={shownId}
          onPick={(group) => {
            setPicked(group);
            setSelection((previous) => previous.clear());
            setSidePanel(null);
          }}
          onClose={() => setSidePanel(null)}
        />
      ) : null}
      {shown && shownId ? (
        <>
          <GroupPreview
            position={position}
            group={shown}
            otherGlyphId={otherGlyphId}
            hovered={hovered}
            selection={current}
            onHover={setHovered}
            onSelect={setSelection}
            onRemove={removeSelected}
          />
          {hasSelection ? (
            <SelectedMembersRow group={shown} selected={current.ids} onRemove={removeSelected} />
          ) : null}
          {sidePanel === "add" ? (
            <AddMembersPanel
              position={position}
              groupId={shownId}
              groupName={shown}
              members={members}
              onClose={() => setSidePanel(null)}
            />
          ) : null}
        </>
      ) : (
        <p className="px-1 text-ui text-muted">
          {glyphName(editor, glyphId)}'s {EDGE_LABEL[position]} has no group. Pick one above to look
          at it, or put {glyphName(editor, glyphId)} in one from the sidebar.
        </p>
      )}
    </div>
  );
}

interface SelectedMembersRowProps {
  readonly group: string;
  readonly selected: readonly GlyphId[];
  readonly onRemove: () => void;
}

/** What is selected in the preview, and the action that takes it out of the group. */
function SelectedMembersRow({ group, selected, onRemove }: SelectedMembersRowProps) {
  const editor = useEditor();
  const only = selected.length === 1 ? selected[0] : undefined;
  const removing = only ? "glyph" : `${selected.length} glyphs`;

  return (
    <div
      data-keeps-member-selection=""
      className="flex h-6 items-center justify-between gap-2 pl-1"
    >
      <span className="truncate text-ui text-primary">
        {only ? glyphName(editor, only) : `${selected.length} glyphs selected`}
      </span>
      <Tooltip>
        <TooltipTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${removing} from ${group}`}
            onClick={onRemove}
          >
            <TrashIcon aria-hidden className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remove from group</TooltipContent>
      </Tooltip>
    </div>
  );
}
