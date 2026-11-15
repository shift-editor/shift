import { createContext, useContext } from "react";
import type { ExportRow, ExportTarget } from "@/types/export";

/** Where one row stands in an export run. */
export type ExportRowStatus = "waiting" | "exporting" | "done" | "failed";

/** What one finished row did: the file or folder it wrote, or the engine's reason it didn't. */
export type ExportRowOutcome = { readonly written: string } | { readonly reason: string };

/**
 * Where the Export section's last run stands: running its rows one after
 * another, finished with every row written, or finished with at least one
 * row failed. Every run keeps each finished row's outcome, for Show in
 * Finder and the reason a row failed.
 */
export type ExportRun =
  | { status: "idle" }
  | {
      status: "exporting";
      rows: Readonly<Record<string, ExportRowStatus>>;
      outcomes: Readonly<Record<string, ExportRowOutcome>>;
      /** Whether Stop was pressed: the running row finishes and the rest are skipped. */
      stopping: boolean;
    }
  | {
      status: "done" | "failed";
      rows: Readonly<Record<string, ExportRowStatus>>;
      outcomes: Readonly<Record<string, ExportRowOutcome>>;
    };

/** The open document's Export rows, their folders, and the run that writes them. */
export interface ExportControls {
  readonly rows: readonly ExportRow[];
  readonly run: ExportRun;
  /** Whether the section is open; it opens itself when a run fails. */
  readonly open: boolean;
  setOpen(open: boolean): void;
  addRow(): void;
  updateRow(id: string, row: Pick<ExportRow, "target" | "output">): void;
  removeRow(id: string): void;
  /** The folder `target` writes into, or null until one is chosen for an unsaved document. */
  folder(target: ExportTarget): string | null;
  /** Asks for the folder `target` writes into. */
  chooseFolder(target: ExportTarget): Promise<void>;
  /** Whether the Export popover is open: what a run will write, then its progress and results. */
  readonly popoverOpen: boolean;
  setPopoverOpen(open: boolean): void;
  /**
   * Writes every row, or only the rows in `only`, one after another. Does
   * nothing while a run is going.
   */
  exportAll(only?: readonly string[]): Promise<void>;
  /** Skips the rows after the one being written. */
  stop(): void;
  /** Shows what row `id` wrote in the last run in Finder. */
  revealRow(id: string): Promise<void>;
  /** Forgets a finished run, so the popover shows what the next one will write. */
  dismiss(): void;
}

export const ExportContext = createContext<ExportControls | null>(null);

export function useExport(): ExportControls {
  const controls = useContext(ExportContext);
  if (!controls) throw new Error("useExport must be used within an ExportProvider");
  return controls;
}
