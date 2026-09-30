import { useMemo, useState } from "react";
import {
  ArrowRight,
  Button,
  Separator,
  LayoutGrid,
  List,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  Toggle,
  ToggleGroup,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToastManager,
} from "@shift/ui";
import { recentFolderLabels, type RecentDocument } from "@shared/recents";
import { RecentFileCard, RecentFileRow } from "./RecentFileItem";
import { getShiftHost } from "@/host/shiftHost";
import { useMinuteClock } from "./useRecentDocuments";
import {
  useRecentFileActions,
  type RecentFileActions,
  type RemovedRecentToast,
} from "./useRecentFileActions";

type RecentView = "grid" | "list";

/** Recent files shown before "View all": two full grid rows. */
const COLLAPSED_COUNT = 8;
const UNDO_TIMEOUT_MS = 6000;
const VIEW_STORAGE_KEY = "launcher.recents.view";

interface RecentFilesProps {
  documents: readonly RecentDocument[];
}

/**
 * Launcher section: Open Font plus recently opened files as a grid or list.
 *
 * @remarks
 * Newest first, showing eight until "View all" is chosen. New Font and Open
 * Font sit in the header. The grid or list choice is remembered per browser
 * profile.
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

  return (
    <section aria-labelledby="recent-files-heading" className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 id="recent-files-heading" className="text-sm font-medium text-primary">
          Recent
        </h2>
        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" className="text-sm" onClick={createFont}>
            New Font
            <span aria-hidden="true" className="ml-2 opacity-70">
              ⌘N
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-md text-sm font-medium"
            onClick={openFont}
          >
            Open Font…
            <span aria-hidden="true" className="ml-2">
              ⌘O
            </span>
          </Button>
          <Separator orientation="vertical" variant="strong" className="h-4" />
          <ViewToggle view={view} onChange={setView} />
        </div>
      </header>
      <div className="flex flex-col gap-4">
        <RecentFileCollection
          documents={shown}
          folders={folders}
          now={now}
          view={view}
          actions={actions}
        />
        {collapsed && (
          <Button
            variant="muted"
            size="sm"
            className="self-end gap-1"
            onClick={() => setExpanded(true)}
          >
            View all ({documents.length})
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </div>
    </section>
  );
};

interface RecentFileCollectionProps {
  documents: readonly RecentDocument[];
  folders: Map<string, string>;
  now: number;
  view: RecentView;
  actions: RecentFileActions;
}

const RecentFileCollection = ({
  documents,
  folders,
  now,
  view,
  actions,
}: RecentFileCollectionProps) => {
  if (documents.length === 0) {
    return <p className="py-10 text-center text-sm text-secondary">No recent fonts</p>;
  }

  if (view === "list") {
    return (
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
    );
  }

  return (
    <ul aria-label="Recent files" className="grid grid-cols-4 gap-4">
      {documents.map((document) => (
        <RecentFileCard
          key={document.path}
          document={document}
          folder={folders.get(document.path)}
          now={now}
          actions={actions}
        />
      ))}
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
    value={[view]}
    onValueChange={(pressed) => {
      const next = pressed.at(0);
      if (next === "grid" || next === "list") onChange(next);
    }}
  >
    <ViewToggleItem value="grid" label="Grid view">
      <LayoutGrid className="size-4" />
    </ViewToggleItem>
    <ViewToggleItem value="list" label="List view">
      <List className="size-4" />
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
  <Tooltip>
    <TooltipTrigger>
      <Toggle value={value} aria-label={label}>
        {children}
      </Toggle>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
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

async function openFont(): Promise<void> {
  try {
    await getShiftHost().commands.run("file.open");
  } catch (error) {
    console.error("opening a font failed", error);
  }
}

async function createFont(): Promise<void> {
  try {
    await getShiftHost().commands.run("file.new");
  } catch (error) {
    console.error("new font failed", error);
  }
}

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
