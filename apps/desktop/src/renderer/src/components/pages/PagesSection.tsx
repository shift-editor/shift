import { useRef, useState, type ComponentType } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  Button,
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
import type { NodeId } from "@shift/types";
import type { PageNode } from "@shift/editor/types";
import {
  CollapsibleSection,
  SidebarActionButton,
  SidebarActionRow,
  type CollapsibleSectionProps,
} from "@/components/sidebar";
import { useActivePageId, usePages } from "@/hooks/usePages";
import { useEditor } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";
import VerticalElipsis from "@/assets/general/vertical-ellipsis.svg";

/** The route that shows the active page's canvas, with no glyph opened. */
export const CANVAS_PATH = "/canvas";

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
  const [open, setOpen] = useState(defaultOpen);
  const [renamingId, setRenamingId] = useState<NodeId | null>(null);

  const createPage = () => {
    const page = editor.pages.create();
    editor.pages.activate(page.id);
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
  const activePageId = useActivePageId();
  const navigate = useNavigate();
  // A page is current only while its canvas shows: never in the font overview or the glyph view.
  const onCanvas = useLocation().pathname === CANVAS_PATH;
  const canDelete = pages.length > 1;

  return (
    <div className="flex flex-col items-start justify-start gap-1">
      {pages.map((page) =>
        page.id === renamingId ? (
          <PageNameField
            key={page.id}
            page={page}
            onDone={(name) => {
              if (name !== null) editor.pages.rename(page.id, name);
              onRenamingChange(null);
            }}
          />
        ) : (
          <SidebarActionRow
            key={page.id}
            data-testid={`page-${page.id}`}
            isSelected={onCanvas && page.id === activePageId}
            onClick={() => {
              editor.pages.activate(page.id);
              navigate(CANVAS_PATH);
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
        ),
      )}
    </div>
  );
};

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
            <MenuItem variant="danger" disabled={!canDelete} onClick={onDelete}>
              Delete page
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};
