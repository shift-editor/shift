import { useId, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useSignalState } from "@shift/editor/signals";
import { asSwapId, type SwapId, type ConditionRange } from "@shift/types";
import {
  Button,
  cn,
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuTrigger,
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
  Separator,
  SortableList,
  Tooltip,
  useSortableItem,
  type SortableActivatorProps,
} from "@shift/ui";
import {
  CollapsibleSection,
  SidebarActionButton,
  type CollapsibleSectionProps,
} from "@/components/sidebar";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { useSidebarPanelAnchor } from "@/hooks/useSidebarPanelAnchor";
import { GlyphSwaps } from "@/lib/variation/GlyphSwaps";
import type { NeverUsedNote, SwapGlyphChoice, SwapRow } from "@/types/conditions";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";
import WarningIcon from "@/assets/general/warning.svg";
import { ConditionChips } from "./ConditionChips";
import { NewSwapPanel } from "./NewSwapPanel";

/**
 * The Designspace tab's Swaps section, after Glyph sources, shown while
 * a glyph is edited: the glyphs drawn in its place where their conditions
 * hold, tried in order, the first match winning. Each is a small tree
 * node: the swap glyph's name, with its condition's chips on
 * a rail under it; a dot under the header's + marks the one the canvas draws
 * here; one that never draws is named in the warning colour, with a ⚠ that explains it.
 * Nodes reorder by dragging the name; right-clicking one opens or deletes it.
 * **+** picks a glyph (or creates `<glyph>.alt`) and starts its first chip;
 * the swap is added when that chip is committed.
 */
export const SwapsSection = ({
  section: Section = CollapsibleSection,
}: {
  /** Draws the section, so it can match the sections around it. */
  section?: ComponentType<CollapsibleSectionProps>;
}) => {
  const editor = useEditor();
  const canAuthor = useFontSession().mode === "workspace";
  const swaps = useMemo(() => new GlyphSwaps(editor), [editor]);
  const section = useSignalState(swaps.sectionCell);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<SwapGlyphChoice | null>(null);

  if (!section) return null;

  const commitDraft = async (range: ConditionRange) => {
    if (!draft) return;

    if (draft.kind === "create") await swaps.createAndAdd(draft.name, range);
    else await swaps.add(draft.glyphId, range);
    setDraft(null);
  };

  const actions = canAuthor ? (
    <NewSwapPanel
      glyphId={section.glyphId}
      newGlyphName={swaps.newGlyphName() ?? section.glyphName}
      onPick={setDraft}
    />
  ) : (
    <Tooltip content="Add a swap">
      <SidebarActionButton label="Add a swap" aria-disabled>
        <PlusIcon className="h-3 w-3" />
      </SidebarActionButton>
    </Tooltip>
  );

  const empty = section.rows.length === 0 && !draft;
  return (
    <>
      <Separator className="-mx-1 w-auto" />
      <Section
        title="Swaps"
        open={open}
        onOpenChange={setOpen}
        actions={actions}
        panelClassName="pt-0"
      >
        {empty ? (
          <p className="pl-2 text-ui text-muted">Draw another glyph in part of the designspace.</p>
        ) : (
          <SortableList
            ids={section.rows.map((row) => row.id)}
            orientation="vertical"
            itemLabel={(id) => section.rows.find((row) => row.id === id)?.glyphName ?? id}
            onMove={(id, index) => void swaps.move(asSwapId(id), index)}
          >
            <div role="list" aria-label="Swaps" className="flex flex-col gap-1">
              {section.rows.map((row) => (
                <SwapRowView key={row.id} row={row} swaps={swaps} canAuthor={canAuthor} />
              ))}
              {draft && (
                <div role="listitem" className="flex flex-col gap-1 pb-1">
                  <span className="truncate px-2 text-ui text-primary">{draft.name}</span>
                  <div className="pl-2">
                    <ConditionChips
                      label={`${draft.name} condition`}
                      chips={[]}
                      space={swaps.chips}
                      startNew
                      onCommit={(_, range) => commitDraft(range)}
                      onRemove={async () => setDraft(null)}
                      onNewCancelled={() => setDraft(null)}
                    />
                  </div>
                </div>
              )}
            </div>
          </SortableList>
        )}
      </Section>
    </>
  );
};

/**
 * One swap as a small tree node, like an Objects panel row with a
 * child: the swap glyph's name, the in-use dot at the right under the header's +; under
 * it, on a rail, its
 * condition's chips. The name drags the node; right-clicking it opens the
 * glyph or deletes the swap. A never-used one has its name in the warning
 * colour and a ⚠ where the dot goes, which explains it and offers a move.
 */
const SwapRowView = ({
  row,
  swaps,
  canAuthor,
}: {
  row: SwapRow;
  swaps: GlyphSwaps;
  canAuthor: boolean;
}) => {
  const sortable = useSortableItem(row.id, !canAuthor);

  return (
    <div
      ref={sortable.itemRef}
      style={sortable.itemStyle}
      role="listitem"
      aria-label={row.glyphName}
      data-testid={`swap-${row.id}`}
      className={cn("relative w-full", sortable.dragging && "z-10 opacity-50")}
    >
      <SwapMenu row={row} swaps={swaps} canAuthor={canAuthor}>
        <div className="flex flex-col rounded px-1 pb-1">
          <div className="flex h-7 items-center gap-1.5">
            <SwapName row={row} activator={sortable.activator} />
            {row.neverUsed !== null && (
              <NeverUsedWarning
                note={row.neverUsed}
                row={row}
                swaps={swaps}
                canAuthor={canAuthor}
              />
            )}
            {row.inUse && (
              // In the column of the section header's +: past the node's padding, as wide as it.
              <span className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center">
                <Tooltip content="Drawn here">
                  <span
                    role="img"
                    aria-label="Drawn here"
                    className="h-1.5 w-1.5 rounded-full bg-accent"
                  />
                </Tooltip>
              </span>
            )}
          </div>
          <div className="relative flex flex-col gap-1 pl-6">
            {/* The rail under the name, as the section and Objects tree rails draw. */}
            <span
              aria-hidden
              className="absolute -top-1 bottom-0 left-2 border-l border-control-muted/45"
            />
            <ConditionChips
              label={`${row.glyphName} condition`}
              chips={row.chips}
              space={swaps.chips}
              disabled={!canAuthor}
              onCommit={(index, range) => swaps.setRange(row.id, index, range)}
              onRemove={(index) => swaps.removeRange(row.id, index)}
            />
          </div>
        </div>
      </SwapMenu>
    </div>
  );
};

/**
 * A swap's name, which drags its node. A swap that never draws has its name
 * in the warning colour, the reason as its description.
 */
const SwapName = ({ row, activator }: { row: SwapRow; activator: SortableActivatorProps }) => {
  const reasonId = useId();
  const note = row.neverUsed;

  return (
    <button
      type="button"
      {...activator}
      aria-describedby={note === null ? undefined : reasonId}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-ui focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
        note === null ? "text-primary" : "text-warning",
      )}
    >
      <span className="truncate">{row.glyphName}</span>
      {note !== null && (
        <span id={reasonId} className="sr-only">
          {note.message}
        </span>
      )}
    </button>
  );
};

/**
 * A never-used swap's ⚠, in the in-use dot's column: a button whose popover,
 * beside the sidebar, says why and offers to move the swap above the one
 * that shadows it, as one undo step.
 */
const NeverUsedWarning = ({
  note,
  row,
  swaps,
  canAuthor,
}: {
  note: NeverUsedNote;
  row: SwapRow;
  swaps: GlyphSwaps;
  canAuthor: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const panelAnchor = useSidebarPanelAnchor();
  const shadow = note.shadowedBy;
  const moveAbove = async () => {
    if (!shadow) return;

    try {
      await swaps.moveAbove(row.id, shadow.id);
      setOpen(false);
    } catch (error) {
      console.error("could not move the swap", error);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger
        ref={panelAnchor.triggerRef}
        aria-label="Why is this swap never used?"
        render={
          // In the in-use dot's column, under the section header's +.
          <button
            type="button"
            className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-warning hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          />
        }
      >
        <WarningIcon aria-hidden className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverPositioner {...panelAnchor.positioner}>
          <PopoverPopup>
            <div className="flex w-56 flex-col items-start gap-2 p-2">
              <p className="text-ui text-primary">{note.message}</p>
              {shadow && canAuthor && (
                <Button size="sm" onClick={() => void moveAbove()}>
                  Move above {shadow.glyphName}
                </Button>
              )}
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};

/** A row's context menu: open the swap glyph, or delete the swap (the glyph stays). */
const SwapMenu = ({
  row,
  swaps,
  canAuthor,
  children,
}: {
  row: SwapRow;
  swaps: GlyphSwaps;
  canAuthor: boolean;
  children: ReactNode;
}) => {
  const catalog = useGlyphCatalog();
  const openGlyph = async () => {
    const glyph = catalog.availableGlyphs.find((candidate) => candidate.id === row.glyphId);
    if (!glyph) return;

    try {
      await catalog.openGlyph(glyph);
    } catch (error) {
      console.error("could not open the swap glyph", error);
    }
  };
  const remove = async (id: SwapId) => {
    try {
      await swaps.remove(id);
    } catch (error) {
      console.error("could not delete the swap", error);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">{children}</ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuPositioner>
          <ContextMenuPopup>
            <ContextMenuItem onClick={() => void openGlyph()}>Open {row.glyphName}</ContextMenuItem>
            <ContextMenuItem disabled={!canAuthor} onClick={() => void remove(row.id)}>
              Delete
            </ContextMenuItem>
          </ContextMenuPopup>
        </ContextMenuPositioner>
      </ContextMenuPortal>
    </ContextMenu>
  );
};
