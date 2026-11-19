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
 * hold, tried in order, the first match winning. Each row is one line: a
 * the alternate glyph's icon, as the Layers panel draws it (its name the tooltip), its
 * condition's chips, and a dot on the one the canvas draws here, which is
 * tinted; one an earlier alternate always beats is greyed with a note. Rows reorder by dragging the icon; right-clicking a row opens or deletes it.
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
 * One alternate on one line: its glyph's icon where the font is drawn now,
 * as the Layers panel draws a glyph (its name the tooltip), its condition's
 * chips, and the in-use dot. The icon drags the row; right-clicking the row
 * opens the glyph or deletes the alternate. A never-used alternate greys its
 * icon and chips, with the note below.
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
  const greyed = row.neverUsed !== null;

  return (
    <div
      ref={sortable.itemRef}
      style={sortable.itemStyle}
      role="listitem"
      aria-label={row.glyphName}
      data-testid={`alternate-${row.id}`}
      className={cn("relative flex w-full flex-col gap-1", sortable.dragging && "z-10 opacity-50")}
    >
      <AlternateMenu row={row} alternates={alternates} canAuthor={canAuthor}>
        <div
          className={cn(
            "flex w-full items-start gap-2 rounded px-1 py-1",
            row.inUse && "bg-accent/10",
          )}
        >
          {/* As tall as a line of chips, so the icon sits on the first line. */}
          <Tooltip content={row.glyphName}>
            <button
              type="button"
              aria-label={row.glyphName}
              {...sortable.activator}
              className={cn(
                "flex h-5 shrink-0 items-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                greyed && "opacity-50",
              )}
            >
              <svg aria-hidden className="h-4 w-4 shrink-0 text-primary" viewBox="0 0 16 16">
                {row.iconPath ? <path d={row.iconPath} fill="currentColor" /> : null}
              </svg>
            </button>
          </Tooltip>
          <div className={cn("min-w-0 flex-1", greyed && "opacity-50")}>
            <ConditionChips
              label={`${row.glyphName} condition`}
              chips={row.chips}
              space={alternates.chips}
              disabled={!canAuthor}
              onCommit={(index, range) => alternates.setRange(row.id, index, range)}
              onRemove={(index) => alternates.removeRange(row.id, index)}
            />
          </div>
          {row.inUse && (
            <Tooltip content="Drawn here">
              <span className="flex h-5 shrink-0 items-center">
                <span
                  role="img"
                  aria-label="Drawn here"
                  className="h-1.5 w-1.5 rounded-full bg-accent"
                />
              </span>
            </Tooltip>
          )}
        </div>
      </AlternateMenu>
      {row.neverUsed && <p className="pl-1 text-ui text-muted">{row.neverUsed}</p>}
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
