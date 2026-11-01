import { useMemo, useState } from "react";
import {
  Button,
  cn,
  LayoutGrid,
  MenuIcon,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  Toggle,
  ToggleGroup,
  Tooltip,
  useToastManager,
} from "@shift/ui";
import { recentFolderLabels, type RecentDocument } from "@shared/recents";
import { RecentFileRow, RecentFileTile, TILE_CLASS } from "./RecentFileItem";
import { useMinuteClock } from "./useRecentDocuments";
import {
  useRecentFileActions,
  type RecentFileActions,
  type RemovedRecentToast,
} from "./useRecentFileActions";

type RecentView = "grid" | "list";

/**
 * Recent files shown before "View all": with the wide tile and the View all
 * tile, two full rows of four.
 */
const COLLAPSED_COUNT = 6;
const UNDO_TIMEOUT_MS = 6000;
const VIEW_STORAGE_KEY = "launcher.recents.view";

interface RecentFilesProps {
  documents: readonly RecentDocument[];
}

/**
 * Launcher section: recently opened files as a grid or list.
 *
 * @remarks
 * Newest first, showing six until "View all" is chosen. The grid or list
 * choice is remembered per browser profile.
 */
export const RecentFiles = ({ documents }: RecentFilesProps) => (
  <ToastProvider timeout={UNDO_TIMEOUT_MS}>
    <RecentFilesSection documents={documents} />
    <ToastViewport className="top-auto bottom-6">
      <RemovedRecentToasts />
    </ToastViewport>
  </ToastProvider>
);

const RecentFilesSection = ({ documents }: RecentFilesProps) => {
  const actions = useRecentFileActions();
  const now = useMinuteClock();
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useStoredChoice<RecentView>(VIEW_STORAGE_KEY, ["grid", "list"], "grid");

  const folders = useMemo(
    () => recentFolderLabels(documents.map((document) => document.path)),
    [documents],
  );
  const collapsed = !expanded && documents.length > COLLAPSED_COUNT;
  const shown = collapsed ? documents.slice(0, COLLAPSED_COUNT) : documents;
  const viewAll = collapsed ? () => setExpanded(true) : null;

  return (
    <section aria-labelledby="recent-files-heading" className="flex flex-col">
      <header className="flex items-center justify-between pb-4">
        <h2 id="recent-files-heading" className="text-heading font-semibold text-primary">
          Recent
        </h2>
        <ViewToggle view={view} onChange={setView} />
      </header>
      <RecentFileCollection
        documents={shown}
        folders={folders}
        now={now}
        view={view}
        actions={actions}
        viewAll={viewAll}
      />
    </section>
  );
};

interface RecentFileCollectionProps {
  documents: readonly RecentDocument[];
  folders: Map<string, string>;
  now: number;
  view: RecentView;
  actions: RecentFileActions;
  /** Shows every recent file; null when they are all shown. */
  viewAll: (() => void) | null;
}

const RecentFileCollection = ({
  documents,
  folders,
  now,
  view,
  actions,
  viewAll,
}: RecentFileCollectionProps) => {
  if (documents.length === 0) {
    return <p className="py-10 text-center text-sm text-secondary">No recent fonts</p>;
  }

  if (view === "list") {
    return (
      <div className="flex flex-col gap-4">
        <ul aria-label="Recent files" className="flex flex-col">
          {documents.map((document) => (
            <RecentFileRow
              key={document.path}
              document={document}
              folder={folders.get(document.path)}
              now={now}
              actions={actions}
            />
          ))}
        </ul>
        {viewAll && (
          <Button variant="muted" size="sm" className="self-end" onClick={viewAll}>
            View all
          </Button>
        )}
      </div>
    );
  }

  return (
    <ul aria-label="Recent files" className="grid grid-cols-4 gap-x-4 gap-y-5">
      {documents.map((document, index) => (
        <RecentFileTile
          key={document.path}
          document={document}
          folder={folders.get(document.path)}
          now={now}
          actions={actions}
          wide={index === 0}
        />
      ))}
      {viewAll && (
        <li>
          <button
            type="button"
            onClick={viewAll}
            className={cn(
              TILE_CLASS,
              "w-full cursor-pointer text-label font-medium text-muted ring-1 ring-chrome ring-inset transition-colors",
              "outline-none hover:bg-hover/50 focus-visible:ring-2 focus-visible:ring-accent",
            )}
          >
            View all
          </button>
        </li>
      )}
    </ul>
  );
};

const ViewToggle = ({
  view,
  onChange,
}: {
  view: RecentView;
  onChange: (view: RecentView) => void;
}) => (
  <ToggleGroup
    aria-label="Recent files layout"
    variant="segmented"
    value={[view]}
    onValueChange={(pressed) => {
      const next = pressed.at(0);
      if (next === "grid" || next === "list") onChange(next);
    }}
  >
    <ViewToggleItem value="grid" label="Grid view">
      <LayoutGrid className="size-3.25" strokeWidth={1.2} />
    </ViewToggleItem>
    <ViewToggleItem value="list" label="List view">
      <MenuIcon className="size-3.25" strokeWidth={1.2} />
    </ViewToggleItem>
  </ToggleGroup>
);

const ViewToggleItem = ({
  value,
  label,
  children,
}: {
  value: RecentView;
  label: string;
  children: React.ReactNode;
}) => (
  <Tooltip content={label}>
    <Toggle variant="segmented" value={value} aria-label={label}>
      {children}
    </Toggle>
  </Tooltip>
);

const RemovedRecentToasts = () => {
  const { toasts, close } = useToastManager();
  const actions = useRecentFileActions();

  return toasts.map((toast) => {
    const removed = (toast.data as RemovedRecentToast | undefined)?.document;

    const undo = async () => {
      close(toast.id);
      if (removed) await actions.undoRemove(removed);
    };

    return (
      <ToastRoot key={toast.id} toast={toast}>
        <div className="flex items-center gap-4 pl-1">
          <ToastTitle>{String(toast.title)}</ToastTitle>
          {removed && (
            <Button variant="ghost" size="sm" onClick={undo}>
              Undo
            </Button>
          )}
        </div>
      </ToastRoot>
    );
  });
};

function useStoredChoice<T extends string>(
  key: string,
  options: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return options.find((option) => option === stored) ?? fallback;
    } catch {
      return fallback;
    }
  });

  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Remembering the choice is a convenience; the in-memory value still applies.
    }
  };

  return [value, update];
}
