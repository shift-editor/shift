import { useCallback, useMemo, useRef, useState, type ComponentType, type MouseEvent } from "react";
import { useLocation } from "react-router";
import {
  Button,
  cn,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
  SortableList,
  Tooltip,
  useInlineRename,
  useSortableItem,
} from "@shift/ui";
import { asNodeId, type NodeId } from "@shift/types";
import type { PageNode } from "@shift/editor/types";
import {
  CollapsibleSection,
  SidebarActionButton,
  SidebarActionRow,
  type CollapsibleSectionProps,
} from "@/components/sidebar";
import { useShownPageId, usePages } from "@/hooks/usePages";
import { useWindowTabs } from "@/hooks/useWindowTabs";
import { CANVAS_PATH } from "@/lib/editorRoute";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";
import VerticalElipsis from "@/assets/general/vertical-ellipsis.svg";

interface PagesSectionProps {
  defaultOpen?: boolean;
  /** Draws the collapsible section, so the list can match the sections around it. */
  section?: ComponentType<CollapsibleSectionProps>;
}

export const PagesSection = ({
  defaultOpen = true,
  section: Section = CollapsibleSection,
}: PagesSectionProps) => {
  const editor = useEditor();
  const { showPage } = useWindowTabs();
  const [open, setOpen] = useState(defaultOpen);
  const [renamingId, setRenamingId] = useState<NodeId | null>(null);

  const createPage = () => {
    const page = editor.pages.create();
    showPage(page.id);
    setOpen(true);
    setRenamingId(page.id);
  };

  return (
    <Section
      title="Pages"
      open={open}
      onOpenChange={setOpen}
      actions={
        <Tooltip content="Add page">
          <SidebarActionButton label="Add page" onClick={createPage}>
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        </Tooltip>
      }
    >
      <Pages renamingId={renamingId} onRenamingChange={setRenamingId} />
    </Section>
  );
};

interface PagesProps {
  renamingId: NodeId | null;
  onRenamingChange: (pageId: NodeId | null) => void;
}

const Pages = ({ renamingId, onRenamingChange }: PagesProps) => {
  const editor = useEditor();
  const pages = usePages();
  const pageIds = useMemo(() => pages.map((page) => page.id), [pages]);
  const pageName = useCallback(
    (id: string) => pages.find((page) => page.id === id)?.name ?? "Page",
    [pages],
  );

  return (
    <SortableList
      ids={pageIds}
      orientation="vertical"
      itemLabel={pageName}
      onMove={(pageId, index) => editor.pages.move(asNodeId(pageId), index)}
    >
      <div className="flex flex-col items-start justify-start gap-1">
        {pages.map((page) => (
          <PageRow
            key={page.id}
            page={page}
            renaming={page.id === renamingId}
            canDelete={pages.length > 1}
            onRenamingChange={onRenamingChange}
          />
        ))}
      </div>
    </SortableList>
  );
};

interface PageRowProps {
  page: PageNode;
  renaming: boolean;
  canDelete: boolean;
  onRenamingChange: (pageId: NodeId | null) => void;
}

const PageRow = ({ page, renaming, canDelete, onRenamingChange }: PageRowProps) => {
  const editor = useEditor();
  const { pageRename } = useFontSession();
  const shownPageId = useShownPageId();
  const { showPage } = useWindowTabs();
  const sortable = useSortableItem(page.id, renaming);
  // A page is current only while its canvas shows: never in the font overview or a glyph tab.
  const onCanvas = useLocation().pathname === CANVAS_PATH;

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const click = { pageId: page.id, x: event.clientX, y: event.clientY, at: event.timeStamp };
    // The second click of a double-click begun in the overview's list lands here.
    if (pageRename.completes(click)) {
      onRenamingChange(page.id);
      return;
    }

    showPage(page.id, { newTab: event.metaKey || event.ctrlKey });
    // Off the canvas the view swaps on this click, so its double-click ends in the canvas's list.
    if (!onCanvas) pageRename.opened(click);
  };

  return (
    <div
      ref={sortable.itemRef}
      style={sortable.itemStyle}
      className={cn("relative w-full", sortable.dragging && "z-10 opacity-50")}
    >
      {renaming ? (
        <PageNameField
          page={page}
          onDone={(name) => {
            if (name !== null) editor.pages.rename(page.id, name);
            onRenamingChange(null);
          }}
        />
      ) : (
        <SidebarActionRow
          data-testid={`page-${page.id}`}
          activator={sortable.activator}
          isSelected={onCanvas && page.id === shownPageId}
          onClick={onClick}
          onDoubleClick={() => onRenamingChange(page.id)}
          actions={
            <PageActionsMenu
              pageName={page.name}
              canDelete={canDelete}
              onRename={() => onRenamingChange(page.id)}
              onDelete={() => editor.pages.delete(page.id)}
            />
          }
        >
          <span className="min-w-0 flex-1 truncate text-left">{page.name}</span>
        </SidebarActionRow>
      )}
    </div>
  );
};

/** Edits a page's name in place of its row; see `useInlineRename`. */
const PageNameField = ({
  page,
  onDone,
}: {
  page: PageNode;
  /** Receives the new name, or null when renaming was cancelled. */
  onDone: (name: string | null) => void;
}) => {
  const field = useInlineRename(page.name, onDone);

  return <Input aria-label="Page name" className="h-7 w-full" {...field} />;
};

const PageActionsMenu = ({
  pageName,
  canDelete,
  onRename,
  onDelete,
}: {
  pageName: string;
  canDelete: boolean;
  onRename: () => void;
  onDelete: () => void;
}) => {
  // Rename focuses the name field; returning focus to the trigger would blur it.
  const renameChosen = useRef(false);

  return (
    <Menu
      modal={false}
      onOpenChange={(open) => {
        if (open) renameChosen.current = false;
      }}
    >
      <Tooltip content="Page actions">
        <MenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${pageName}`} />}
        >
          <VerticalElipsis className="h-5 w-5 text-icon-subtle" />
        </MenuTrigger>
      </Tooltip>
      <MenuPortal>
        <MenuPositioner sideOffset={4} align="start">
          <MenuPopup finalFocus={() => !renameChosen.current}>
            <MenuItem
              onClick={() => {
                renameChosen.current = true;
                onRename();
              }}
            >
              Rename
            </MenuItem>
            <MenuSeparator />
            <MenuItem disabled={!canDelete} onClick={onDelete}>
              Delete
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};
