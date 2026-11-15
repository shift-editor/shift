import { createContext, useContext } from "react";
import type { ExportRow, ExportTarget } from "@/types/export";

/** Where one row stands in an export run. */
export type ExportRowStatus = "waiting" | "exporting" | "done" | "failed";

/**
 * Where the Export section's last run stands: running its rows one after
 * another, finished with every row written, or finished with at least one
 * row failed.
 */
export type ExportRun =
  | { status: "idle" }
  | {
      status: "exporting";
      rows: Readonly<Record<string, ExportRowStatus>>;
      /** Whether Stop was pressed: the running row finishes and the rest are skipped. */
      stopping: boolean;
    }
  | {
      status: "done";
      rows: Readonly<Record<string, ExportRowStatus>>;
      /** The last file or folder written, for Show in Finder. */
      written: string;
    }
  | {
      status: "failed";
      rows: Readonly<Record<string, ExportRowStatus>>;
      /** The engine's message for the first row that failed. */
      reason: string;
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
  /** Writes every row, one after another. Does nothing while a run is going. */
  exportAll(): Promise<void>;
  /** Skips the rows after the one being written. */
  stop(): void;
  /** Shows the last file the finished run wrote in Finder. */
  reveal(): Promise<void>;
}

export const ExportContext = createContext<ExportControls | null>(null);

export function useExport(): ExportControls {
  const controls = useContext(ExportContext);
  if (!controls) throw new Error("useExport must be used within an ExportProvider");
  return controls;
}
