import { useMemo } from "react";
import { useLocation } from "react-router";
import {
  Button,
  DocumentTab,
  DocumentTabs,
  DocumentTabsDivider,
  FileIcon,
  SortableList,
  Tooltip,
  useSortableItem,
} from "@shift/ui";
import { useSignalState } from "@shift/editor/signals";
import type { GlyphId } from "@shift/types";
import GridIcon from "@/assets/toolbar/grid.svg";
import PlusIcon from "@/assets/general/plus.svg";
import { useShownPageId } from "@/hooks/usePages";
import { useWindowTabs } from "@/hooks/useWindowTabs";
import {
  isMovableTab,
  windowLocation,
  type MovableTab,
  type WindowTab,
} from "@/lib/tabs/WindowTabs";
import { useEditor } from "@/workspace/WorkspaceContext";

/**
 * The window's tabs, in the title bar: the font overview, pinned first, then the
 * pages and glyphs open in this window, and a button that adds a page.
 */
export const WindowTabsBar = () => {
  const editor = useEditor();
  const { tabs, show, showPage, close } = useWindowTabs();
  const openTabs = useSignalState(tabs.tabsCell);
  const pages = useSignalState(editor.scene.pagesCell);
  const shownPageId = useShownPageId();
  const location = windowLocation(useLocation().pathname, shownPageId);
  const active = tabs.activeTab(location);

  const overview = openTabs[0];
  const rest = useMemo(() => openTabs.filter(isMovableTab), [openTabs]);
  const restIds = useMemo(() => rest.map((tab) => tab.id), [rest]);
  const label = (tab: WindowTab): string => {
    switch (tab.kind) {
      case "glyphs":
        return "Glyphs";
      case "page":
        return pages.find((page) => page.id === tab.pageId)?.name ?? "Page";
      case "glyph":
        return editor.font.entryForId(tab.glyphId)?.name ?? "Glyph";
    }
  };

  const tabLabel = (id: string): string => {
    const tab = tabs.tab(id);
    return tab ? label(tab) : "Tab";
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DocumentTabs
        aria-label="Open tabs"
        value={active?.id ?? null}
        onValueChange={(id) => {
          const tab = tabs.tab(id);
          if (tab) show(tab);
        }}
      >
        {overview ? (
          <DocumentTab
            value={overview.id}
            label="Glyphs"
            data-testid="tab-glyphs"
            icon={<GridIcon className="h-4 w-4" />}
          />
        ) : null}
        {rest.length > 0 ? <DocumentTabsDivider /> : null}
        {/* The overview stays pinned first; only the tabs after it reorder. */}
        <SortableList
          ids={restIds}
          orientation="horizontal"
          itemLabel={tabLabel}
          onMove={(id, index) => tabs.move(id, index)}
        >
          {rest.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              label={label(tab)}
              onClose={() => close(tab, tab.id === active?.id)}
            />
          ))}
        </SortableList>
      </DocumentTabs>
      <Tooltip content="New page">
        <Button
          variant="toolbar"
          size="icon-sm"
          aria-label="New page"
          className="shrink-0"
          onClick={() => showPage(editor.pages.create().id, { newTab: true })}
        >
          <PlusIcon className="h-3 w-3" />
        </Button>
      </Tooltip>
    </div>
  );
};

/** A page or glyph tab that reorders by dragging or from the keyboard. */
const SortableTab = ({
  tab,
  label,
  onClose,
}: {
  tab: MovableTab;
  label: string;
  onClose: () => void;
}) => {
  const editor = useEditor();
  const sortable = useSortableItem(tab.id);

  return (
    <DocumentTab
      value={tab.id}
      label={label}
      sortable={sortable}
      data-testid={`tab-${tab.kind}`}
      icon={
        tab.kind === "glyph" ? (
          <GlyphMark glyphId={tab.glyphId} />
        ) : (
          <FileIcon aria-hidden className="h-4 w-4" strokeWidth={1.5} />
        )
      }
      onRename={tab.kind === "page" ? (name) => editor.pages.rename(tab.pageId, name) : undefined}
      onClose={onClose}
    />
  );
};

/** The glyph's own character as its tab's icon, or a dot for a glyph with no Unicode value. */
const GlyphMark = ({ glyphId }: { glyphId: GlyphId }) => {
  const editor = useEditor();
  const unicode = editor.font.entryForId(glyphId)?.unicodes[0] ?? null;
  if (unicode === null) return <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />;

  return (
    <span aria-hidden className="text-sm leading-none font-semibold">
      {String.fromCodePoint(unicode)}
    </span>
  );
};
