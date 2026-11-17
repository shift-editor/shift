import { useEffect, type ReactNode } from "react";
import { effect } from "@shift/editor/signals";
import type { HistoryReplay } from "@shift/editor";
import { ToastProvider, ToastRoot, ToastTitle, ToastViewport, useToastManager } from "@shift/ui";
import { useFontSession } from "@/workspace/WorkspaceContext";

/** How long a grid action's confirmation stays up. */
const TOAST_TIMEOUT_MS = 2500;

interface GridToastsProps {
  /** Whether the grid is the page showing; undo and redo are announced only then. */
  readonly active: boolean;
  readonly children: ReactNode;
}

/**
 * Gives the glyph grid somewhere to say what an action did, above its footer:
 * how many glyphs a decompose changed, or which step undo or redo replayed,
 * since most grid edits change nothing a tile shows.
 */
export const GridToasts = ({ active, children }: GridToastsProps) => (
  <ToastProvider timeout={TOAST_TIMEOUT_MS}>
    {children}
    <ToastViewport className="top-auto bottom-12">
      <GridToastList active={active} />
    </ToastViewport>
  </ToastProvider>
);

const GridToastList = ({ active }: { active: boolean }) => {
  const { toasts, add } = useToastManager();
  const { editor } = useFontSession();

  useEffect(() => {
    if (!active) return;

    // The first run reads the step replayed before the grid showed, which is old news.
    const announced = editor.history.replayedCell.peek();
    const subscription = effect(() => {
      const replay = editor.history.replayedCell.value;
      if (!replay || replay === announced) return;

      add({ title: replayTitle(replay) });
    });
    return () => subscription.dispose();
  }, [active, editor, add]);

  return toasts.map((toast) => (
    <ToastRoot key={toast.id} toast={toast}>
      <ToastTitle>{String(toast.title)}</ToastTitle>
    </ToastRoot>
  ));
};

/** What a toast says about a replayed step: `Undid Decompose Components`. */
function replayTitle({ direction, label }: HistoryReplay): string {
  return `${direction === "undo" ? "Undid" : "Redid"} ${label}`;
}
