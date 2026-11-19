import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useSignalState } from "@shift/editor/signals";
import { asAlternateId, type AlternateId, type ConditionRange } from "@shift/types";
import {
  cn,
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuTrigger,
  Separator,
  SortableList,
  Tooltip,
  useSortableItem,
} from "@shift/ui";
import {
  CollapsibleSection,
  SidebarActionButton,
  type CollapsibleSectionProps,
} from "@/components/sidebar";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { GlyphAlternates } from "@/lib/variation/GlyphAlternates";
import type { AlternateGlyphChoice, AlternateRow } from "@/types/conditions";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";
import { ConditionChips } from "./ConditionChips";
import { NewAlternatePanel } from "./NewAlternatePanel";

/**
 * The Designspace tab's Alternates section, after Glyph sources, shown while
 * a glyph is edited: the glyphs drawn in its place where their conditions
 * hold, tried in order, the first match winning. Each is a small tree
 * node: the alternate glyph's name, with its condition's chips on
 * a rail under it; a dot marks, and a tint covers, the one the canvas draws
 * here, and one an earlier alternate always beats is greyed with a note.
 * Nodes reorder by dragging the name; right-clicking one opens or deletes it.
 * **+** picks a glyph (or creates `<glyph>.alt`) and starts its first chip;
 * the alternate is added when that chip is committed.
 */
export const AlternatesSection = ({
  section: Section = CollapsibleSection,
}: {
  /** Draws the section, so it can match the sections around it. */
  section?: ComponentType<CollapsibleSectionProps>;
}) => {
  const editor = useEditor();
  const canAuthor = useFontSession().mode === "workspace";
  const alternates = useMemo(() => new GlyphAlternates(editor), [editor]);
  const section = useSignalState(alternates.sectionCell);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<AlternateGlyphChoice | null>(null);

  if (!section) return null;

  const commitDraft = async (range: ConditionRange) => {
    if (!draft) return;

    if (draft.kind === "create") await alternates.createAndAdd(draft.name, range);
    else await alternates.add(draft.glyphId, range);
    setDraft(null);
  };

  const actions = canAuthor ? (
    <NewAlternatePanel
      glyphId={section.glyphId}
      newGlyphName={alternates.newGlyphName() ?? section.glyphName}
      onPick={setDraft}
    />
  ) : (
    <Tooltip content="Add an alternate">
      <SidebarActionButton label="Add an alternate" aria-disabled>
        <PlusIcon className="h-3 w-3" />
      </SidebarActionButton>
    </Tooltip>
  );

  const empty = section.rows.length === 0 && !draft;
  return (
    <>
      <Separator className="-mx-1 w-auto" />
      <Section title="Alternates" open={open} onOpenChange={setOpen} actions={actions}>
        {empty ? (
          <p className="pl-2 text-ui text-muted">None</p>
        ) : (
          <SortableList
            ids={section.rows.map((row) => row.id)}
            orientation="vertical"
            itemLabel={(id) => section.rows.find((row) => row.id === id)?.glyphName ?? id}
            onMove={(id, index) => void alternates.move(asAlternateId(id), index)}
          >
            <div role="list" aria-label="Alternates" className="flex flex-col gap-1">
              {section.rows.map((row) => (
                <AlternateRowView
                  key={row.id}
                  row={row}
                  alternates={alternates}
                  canAuthor={canAuthor}
                />
              ))}
              {draft && (
                <div role="listitem" className="flex flex-col gap-1 pb-1">
                  <span className="truncate px-2 text-ui text-primary">{draft.name}</span>
                  <div className="pl-2">
                    <ConditionChips
                      label={`${draft.name} condition`}
                      chips={[]}
                      space={alternates.chips}
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
 * One alternate as a small tree node, like an Objects panel row with a
 * child: the alternate glyph's name, with the in-use dot at the right; under
 * it, on a rail, its
 * condition's chips. The name drags the node; right-clicking it opens the
 * glyph or deletes the alternate. The one drawn here is tinted; a
 * never-used one is greyed, with its note under the chips.
 */
const AlternateRowView = ({
  row,
  alternates,
  canAuthor,
}: {
  row: AlternateRow;
  alternates: GlyphAlternates;
  canAuthor: boolean;
}) => {
  const sortable = useSortableItem(row.id, !canAuthor);

  return (
    <div
      ref={sortable.itemRef}
      style={sortable.itemStyle}
      role="listitem"
      aria-label={row.glyphName}
      data-testid={`alternate-${row.id}`}
      className={cn("relative w-full", sortable.dragging && "z-10 opacity-50")}
    >
      <AlternateMenu row={row} alternates={alternates} canAuthor={canAuthor}>
        <div
          className={cn(
            "flex flex-col rounded px-1 pb-1",
            row.inUse && "bg-accent/10",
            row.neverUsed !== null && "opacity-50",
          )}
        >
          <div className="flex h-7 items-center gap-1.5">
            <button
              type="button"
              {...sortable.activator}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-ui text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <span className="truncate" title={row.glyphName}>
                {row.glyphName}
              </span>
            </button>
            {row.inUse && (
              <Tooltip content="Drawn here">
                <span
                  role="img"
                  aria-label="Drawn here"
                  className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                />
              </Tooltip>
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
              space={alternates.chips}
              disabled={!canAuthor}
              onCommit={(index, range) => alternates.setRange(row.id, index, range)}
              onRemove={(index) => alternates.removeRange(row.id, index)}
            />
            {row.neverUsed && <p className="text-ui text-muted">{row.neverUsed}</p>}
          </div>
        </div>
      </AlternateMenu>
    </div>
  );
};

/** A row's context menu: open the alternate glyph, or delete the alternate (the glyph stays). */
const AlternateMenu = ({
  row,
  alternates,
  canAuthor,
  children,
}: {
  row: AlternateRow;
  alternates: GlyphAlternates;
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
      console.error("could not open the alternate glyph", error);
    }
  };
  const remove = async (id: AlternateId) => {
    try {
      await alternates.remove(id);
    } catch (error) {
      console.error("could not delete the alternate", error);
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
