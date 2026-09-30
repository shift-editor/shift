import { useMemo, useState } from "react";
import {
  ArrowRight,
  Button,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from "@shift/ui";
import { recentFolderLabels, type RecentDocument } from "@shared/recents";
import { NewFontCard, RecentFileCard } from "./RecentFileItem";
import { getShiftHost } from "@/host/shiftHost";
import { useMinuteClock } from "./useRecentDocuments";
import {
  useRecentFileActions,
  type RecentFileActions,
  type RemovedRecentToast,
} from "./useRecentFileActions";

/** Recent files shown before "View all"; with the New font card, two full grid rows. */
const COLLAPSED_COUNT = 9;
const UNDO_TIMEOUT_MS = 6000;

interface RecentFilesProps {
  documents: readonly RecentDocument[];
}

/**
 * Launcher section: Open Font plus a grid of recently opened files.
 *
 * @remarks
 * Newest first after a New font card, showing nine until "View all" is chosen.
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
        <Button variant="muted" size="sm" className="-mr-2 text-sm" onClick={openFont}>
          Open Font…
          <span aria-hidden="true" className="ml-2">
            ⌘O
          </span>
        </Button>
      </header>
      <RecentFileCollection documents={shown} folders={folders} now={now} actions={actions} />
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
    </section>
  );
};

interface RecentFileCollectionProps {
  documents: readonly RecentDocument[];
  folders: Map<string, string>;
  now: number;
  actions: RecentFileActions;
}

const RecentFileCollection = ({ documents, folders, now, actions }: RecentFileCollectionProps) => {
  return (
    <ul aria-label="Recent files" className="grid grid-cols-5 gap-4">
      <NewFontCard onCreate={createFont} />
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
