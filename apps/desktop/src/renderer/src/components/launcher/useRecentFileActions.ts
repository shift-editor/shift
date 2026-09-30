import { useMemo } from "react";
import { useToastManager } from "@shift/ui";
import { pathBasename, type RecentDocument } from "@shared/recents";
import { getShiftHost } from "@/host/shiftHost";

/** Undo payload carried by the "removed from Recents" toast. */
export type RemovedRecentToast = { document: RecentDocument };

/** What a user can do with one recent file from the launcher. */
export type RecentFileActions = {
  open: (document: RecentDocument) => Promise<void>;
  locate: (document: RecentDocument) => Promise<void>;
  reveal: (document: RecentDocument) => Promise<void>;
  copyPath: (document: RecentDocument) => Promise<void>;
  /** Removes the file from recents and offers undo in a toast. */
  remove: (document: RecentDocument) => Promise<void>;
  undoRemove: (document: RecentDocument) => Promise<void>;
};

/**
 * Binds recent-file actions to the Shift host and the launcher's toast manager.
 *
 * @remarks
 * Must render inside the launcher's `ToastProvider`. Failures are logged; open
 * and locate failures already raise a native message from main.
 */
export function useRecentFileActions(): RecentFileActions {
  const toasts = useToastManager();

  return useMemo(() => {
    const host = getShiftHost();

    const run = async (label: string, action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        console.error(`${label} failed`, error);
      }
    };

    return {
      open: (document) => run("opening recent file", () => host.recents.open(document.path)),
      locate: (document) => run("locating recent file", () => host.recents.locate(document.path)),
      reveal: (document) => run("revealing recent file", () => host.recents.reveal(document.path)),
      copyPath: (document) =>
        run("copying recent file path", () => host.clipboard.writeText(document.path)),
      remove: (document) =>
        run("removing recent file", async () => {
          const removed = await host.recents.remove(document.path);
          if (!removed) return;

          toasts.add<RemovedRecentToast>({
            title: `Removed ${pathBasename(removed.path)} from Recents`,
            data: { document: removed },
          });
        }),
      undoRemove: (document) => run("restoring recent file", () => host.recents.restore(document)),
    };
  }, [toasts]);
}
