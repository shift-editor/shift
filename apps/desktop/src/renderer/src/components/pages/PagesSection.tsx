import { useEffect, useRef, useState, type ComponentType } from "react";
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
  Tooltip,
} from "@shift/ui";
import { asNodeId, type NodeId } from "@shift/types";
import type { PageNode } from "@shift/editor/types";
import { useSignalState } from "@shift/editor/signals";
import {
  CollapsibleSection,
  SidebarActionButton,
  SidebarActionRow,
  type CollapsibleSectionProps,
} from "@/components/sidebar";
import { useShownPageId, usePages } from "@/hooks/usePages";
import { usePointerReorder } from "@/hooks/usePointerReorder";
import { useWindowTabs } from "@/hooks/useWindowTabs";
import { CANVAS_PATH } from "@/lib/editorRoute";
import { pageRenameRequests, renameOnDoubleClick } from "@/lib/pages/pageRename";
import { useEditor } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";
import VerticalElipsis from "@/assets/general/vertical-ellipsis.svg";

interface PagesSectionProps {
  defaultOpen?: boolean;
  /**
   * Starts renaming the page a double-click from elsewhere asked for. Only the
   * pages list shown on the canvas takes requests.
   */
  takesRenameRequests?: boolean;
  /** Draws the collapsible section, so the list can match the sections around it. */
  section?: ComponentType<CollapsibleSectionProps>;
}

export const PagesSection = ({
  defaultOpen = true,
  takesRenameRequests = false,
  section: Section = CollapsibleSection,
}: PagesSectionProps) => {
  const editor = useEditor();
  const { showPage } = useWindowTabs();
  const [open, setOpen] = useState(defaultOpen);
  const [renamingId, setRenamingId] = useState<NodeId | null>(null);
  const renameRequest = useSignalState(pageRenameRequests(editor));
  useEffect(() => {
    if (!takesRenameRequests || renameRequest === null) return;
    setOpen(true);
    setRenamingId(renameRequest);
    pageRenameRequests(editor).set(null);
  }, [editor, renameRequest, takesRenameRequests]);

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
  const activePageId = useShownPageId();
  const { showPage } = useWindowTabs();
  // A page is current only while its canvas shows: never in the font overview or the glyph view.
  const onCanvas = useLocation().pathname === CANVAS_PATH;
  const canDelete = pages.length > 1;
  const reorder = usePointerReorder(
    pages.map((page) => page.id),
    (pageId, index) => editor.pages.move(asNodeId(pageId), index),
  );

  return (
    <div className="flex flex-col items-start justify-start gap-1">
      {pages.map((page, index) => (
        <div
          key={page.id}
          data-reorder-id={page.id}
          className={cn("relative w-full", reorder.drag?.id === page.id && "opacity-50")}
          onPointerDown={page.id === renamingId ? undefined : reorder.startDrag(page.id)}
          onClickCapture={reorder.onClickCapture}
        >
          {reorder.dropsBefore(index) ? <DropLine edge="top" /> : null}
          {index === pages.length - 1 && reorder.dropsBefore(pages.length) ? (
            <DropLine edge="bottom" />
          ) : null}
          {page.id === renamingId ? (
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
              isSelected={onCanvas && page.id === activePageId}
              onClick={(event) => {
                showPage(page.id, { newTab: event.metaKey || event.ctrlKey });
                // Off the canvas the view swaps on this click, so its double-click renames there.
                if (!onCanvas) {
                  renameOnDoubleClick(editor, page.id, { x: event.clientX, y: event.clientY });
                }
              }}
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
      ))}
    </div>
  );
};

/** Where a dragged page would drop: a line on the row's top or bottom edge, in the gap. */
const DropLine = ({ edge }: { edge: "top" | "bottom" }) => (
  <span
    aria-hidden
    className={cn(
      "pointer-events-none absolute right-0 left-0 z-10 h-0.5 rounded-full bg-accent",
      edge === "top" ? "-top-0.75" : "-bottom-0.75",
    )}
  />
);

/**
 * Edits a page's name in place of its row.
 *
 * @remarks
 * Enter or blur commits the draft; Escape reports null so nothing is renamed.
 * Editor shortcuts do not fire while it is focused.
 */
const PageNameField = ({
  page,
  onDone,
}: {
  page: PageNode;
  onDone: (name: string | null) => void;
}) => {
  const [draft, setDraft] = useState(page.name);
  const cancelled = useRef(false);

  return (
    <Input
      autoFocus
      aria-label="Page name"
      value={draft}
      className="h-7 w-full"
      onChange={(event) => setDraft(event.currentTarget.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => onDone(cancelled.current ? null : draft)}
      onKeyDown={(event) => {
        event.nativeEvent.stopImmediatePropagation();
        if (event.key === "Escape") cancelled.current = true;
        if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
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
