import { useMemo, useState, type ComponentType } from "react";
import { useSignalState } from "@shift/editor/signals";
import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  Separator,
  Tooltip,
} from "@shift/ui";
import {
  CollapsibleSection,
  SidebarActionButton,
  SidebarActionRow,
  type CollapsibleSectionProps,
} from "@/components/sidebar";
import { deleteGlyphSource, glyphSourcesCell, selectGlyphSource } from "@/lib/variation/glyphAxes";
import type { GlyphSourceRow } from "@/types/glyphAxes";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";
import { NewGlyphSourcePanel } from "./NewGlyphSourcePanel";
import VerticalElipsis from "@/assets/general/vertical-ellipsis.svg";

/**
 * The Designspace tab's Glyph sources section, after Instances, shown while
 * a glyph is edited: the glyph's own sources, its drawings off the font's
 * sources (brace drawings included), each named by where it sits. A glyph
 * with none says "None". Selecting one moves the sliders there and edits it;
 * its ⋮ deletes it. **+** opens the New glyph source panel beside the
 * sidebar, prefilled with where the sliders sit.
 */
export const GlyphSourcesSection = ({
  section: Section = CollapsibleSection,
}: {
  /** Draws the section, so it can match Sources and Instances around it. */
  section?: ComponentType<CollapsibleSectionProps>;
}) => {
  const editor = useEditor();
  const canAuthor = useFontSession().mode === "workspace";
  const rowsCell = useMemo(() => glyphSourcesCell(editor), [editor]);
  const rows = useSignalState(rowsCell);
  const [open, setOpen] = useState(true);

  if (!rows) return null;

  return (
    <>
      <Separator className="-mx-1 w-auto" />
      <Section
        title="Glyph sources"
        open={open}
        onOpenChange={setOpen}
        actions={<AddGlyphSourceButton canAuthor={canAuthor} />}
      >
        {rows.length === 0 ? (
          <p className="pl-2 text-ui text-muted">None</p>
        ) : (
          <div
            role="group"
            aria-label="Glyph sources"
            className="flex flex-col items-start justify-start gap-1"
          >
            {rows.map((row) => (
              <GlyphSourceRowView
                key={row.layerId}
                row={row}
                canAuthor={canAuthor}
                onSelect={() => selectGlyphSource(editor, row.layerId)}
                onDelete={() => void deleteGlyphSource(editor, row.layerId)}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  );
};

/** The section's **+**: opens the New glyph source panel, or shows it is unavailable in a preview. */
const AddGlyphSourceButton = ({ canAuthor }: { canAuthor: boolean }) => {
  if (!canAuthor) {
    return (
      <Tooltip content="New glyph source">
        <SidebarActionButton label="New glyph source" aria-disabled>
          <PlusIcon className="h-3 w-3" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return <NewGlyphSourcePanel />;
};

/** One glyph source: its location's name, selected while it is the one edited. */
const GlyphSourceRowView = ({
  row,
  canAuthor,
  onSelect,
  onDelete,
}: {
  row: GlyphSourceRow;
  canAuthor: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) => (
  <SidebarActionRow
    data-testid={`glyph-source-${row.layerId}`}
    isActive={row.active}
    isSelected={row.active}
    onClick={onSelect}
    actions={<GlyphSourceActions name={row.name} disabled={!canAuthor} onDelete={onDelete} />}
  >
    <span className="min-w-0 flex-1 truncate text-left" title={row.name}>
      {row.name}
    </span>
  </SidebarActionRow>
);

const GlyphSourceActions = ({
  name,
  disabled,
  onDelete,
}: {
  name: string;
  disabled: boolean;
  onDelete: () => void;
}) => {
  if (disabled) {
    return (
      <Tooltip content="Glyph source actions unavailable in preview mode">
        <SidebarActionButton label={`Actions for ${name}`} aria-disabled>
          <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return (
    <Menu modal={false}>
      <Tooltip content="Glyph source actions">
        <MenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} />}
        >
          <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
        </MenuTrigger>
      </Tooltip>
      <MenuPortal>
        <MenuPositioner sideOffset={4} align="start">
          <MenuPopup>
            <MenuItem onClick={onDelete}>Delete</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};
