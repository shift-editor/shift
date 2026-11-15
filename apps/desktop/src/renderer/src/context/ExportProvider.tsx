import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSignalState } from "@shift/editor/signals";
import { getShiftHost } from "@/host/shiftHost";
import { errorReason } from "@/lib/export/errorReason";
import { ExportFolders } from "@/lib/export/ExportFolders";
import { ExportSetup, newRowId } from "@/lib/export/ExportSetup";
import {
  EXPORT_TARGETS,
  exportRequestFor,
  outputsFor,
  type ExportRow,
  type ExportTarget,
} from "@/types/export";
import type { Workspace } from "@/workspace/Workspace";
import { useFontSession } from "@/workspace/WorkspaceContext";
import {
  ExportContext,
  type ExportControls,
  type ExportRowStatus,
  type ExportRun,
} from "./ExportContext";

/** How long a finished run shows "Exported" before the section goes back to Export. */
const DONE_NOTICE_MS = 4000;

/**
 * Holds the open document's Export rows and runs them, for the Export section
 * in both Home's and the editor's left sidebars, so both show the same run.
 */
export const ExportProvider = ({ children }: { children: ReactNode }) => {
  const session = useFontSession();
  if (session.mode !== "workspace") {
    return <PreviewExportProvider>{children}</PreviewExportProvider>;
  }

  return (
    <WorkspaceExportProvider workspace={session.workspace}>{children}</WorkspaceExportProvider>
  );
};

/** A preview can't be exported until it is saved as a .shift document; its rows only show. */
const PreviewExportProvider = ({ children }: { children: ReactNode }) => {
  const setup = useMemo(() => new ExportSetup(), []);
  const [open, setOpen] = useState(true);
  const controls = useMemo<ExportControls>(
    () => ({
      rows: setup.rows(null),
      run: { status: "idle" },
      open,
      setOpen,
      addRow: () => {},
      updateRow: () => {},
      removeRow: () => {},
      folder: () => null,
      chooseFolder: async () => {},
      exportAll: async () => {},
      stop: () => {},
      reveal: async () => {},
    }),
    [open, setup],
  );

  return <ExportContext.Provider value={controls}>{children}</ExportContext.Provider>;
};

const WorkspaceExportProvider = ({
  workspace,
  children,
}: {
  workspace: Workspace;
  children: ReactNode;
}) => {
  const document = useSignalState(workspace.documentStateCell);
  const documentKey = document === null ? null : (document.saveTarget ?? "unsaved");
  const setup = useMemo(() => new ExportSetup(), []);
  const folders = useMemo(() => new ExportFolders(), []);
  const [rows, setRows] = useState<readonly ExportRow[]>(() => setup.rows(document));
  const [open, setOpenState] = useState(() => setup.isOpen(document));
  const [chosen, setChosen] = useState<Partial<Record<ExportTarget, string>>>({});
  const [run, setRun] = useState<ExportRun>({ status: "idle" });
  const stopping = useRef(false);
  const documentRef = useRef(document);
  documentRef.current = document;

  // A different document (or the first save of this one) brings its own rows and folders.
  useEffect(() => {
    const current = documentRef.current;
    setRows(setup.rows(current));
    setOpenState(setup.isOpen(current));
    setChosen({});
  }, [documentKey, setup]);

  const changeRows = useCallback(
    (change: (rows: readonly ExportRow[]) => readonly ExportRow[]) => {
      setRows((previous) => {
        const next = change(previous);
        const current = documentRef.current;
        if (current !== null) setup.rememberRows(current, next);
        return next;
      });
      setRun((previous) => (previous.status === "exporting" ? previous : { status: "idle" }));
    },
    [setup],
  );

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      const current = documentRef.current;
      if (current !== null) setup.rememberOpen(current, next);
    },
    [setup],
  );

  const folder = useCallback(
    (target: ExportTarget) => {
      const picked = chosen[target];
      if (picked !== undefined) return picked;
      return document === null ? null : folders.folder(document, target);
    },
    [chosen, document, folders],
  );

  const remember = useCallback(
    (target: ExportTarget, picked: string) => {
      setChosen((previous) => ({ ...previous, [target]: picked }));
      const current = documentRef.current;
      if (current !== null) folders.remember(current, target, picked);
    },
    [folders],
  );

  const askForFolder = useCallback(
    async (target: ExportTarget): Promise<string | null> => {
      const picked = await getShiftHost().exports.chooseFolder(folder(target));
      if (picked !== null) remember(target, picked);
      return picked;
    },
    [folder, remember],
  );

  const exportAll = useCallback(async () => {
    if (run.status === "exporting" || rows.length === 0) return;

    const statuses: Record<string, ExportRowStatus> = {};
    for (const row of rows) statuses[row.id] = "waiting";
    const show = (next: Partial<Record<string, ExportRowStatus>>) =>
      setRun({ status: "exporting", rows: { ...Object.assign(statuses, next) }, stopping: false });

    stopping.current = false;
    show({});
    let written: string | null = null;
    let reason: string | null = null;
    // Folders chosen during this run, so two rows of one target ask only once.
    const directories: Partial<Record<ExportTarget, string>> = {};

    for (const row of rows) {
      if (stopping.current) break;

      const directory =
        directories[row.target] ?? folder(row.target) ?? (await askForFolder(row.target));
      if (directory === null) {
        setRun({ status: "idle" });
        return;
      }
      directories[row.target] = directory;

      show({ [row.id]: "exporting" });
      try {
        const result = await workspace.editCoordinator.export({
          directory,
          mode: "write",
          ...exportRequestFor(row),
        });
        remember(row.target, directory);
        written = result.path;
        show({ [row.id]: "done" });
      } catch (error) {
        reason ??= errorReason(error);
        show({ [row.id]: "failed" });
      }
    }

    if (reason !== null) {
      setRun({ status: "failed", rows: { ...statuses }, reason });
      setOpen(true);
      return;
    }
    if (written === null || stopping.current) {
      setRun({ status: "idle" });
      return;
    }
    setRun({ status: "done", rows: { ...statuses }, written });
  }, [askForFolder, folder, remember, rows, run.status, setOpen, workspace]);

  // "Exported" shows for a moment, then the section goes back to its Export button.
  useEffect(() => {
    if (run.status !== "done") return;
    const timer = setTimeout(() => setRun({ status: "idle" }), DONE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [run]);

  const controls = useMemo<ExportControls>(
    () => ({
      rows,
      run,
      open,
      setOpen,
      addRow: () => changeRows((previous) => [...previous, nextRow(previous)]),
      updateRow: (id, row) =>
        changeRows((previous) =>
          previous.map((existing) => (existing.id === id ? { ...existing, ...row } : existing)),
        ),
      removeRow: (id) => changeRows((previous) => previous.filter((row) => row.id !== id)),
      folder,
      chooseFolder: async (target) => {
        await askForFolder(target);
      },
      exportAll,
      stop: () => {
        stopping.current = true;
        setRun((previous) =>
          previous.status === "exporting" ? { ...previous, stopping: true } : previous,
        );
      },
      reveal: async () => {
        if (run.status !== "done") return;
        await getShiftHost().exports.reveal(run.written);
      },
    }),
    [askForFolder, changeRows, exportAll, folder, open, rows, run, setOpen],
  );

  return <ExportContext.Provider value={controls}>{children}</ExportContext.Provider>;
};

/** The first target and output not already a row, or another variable TrueType when all are. */
function nextRow(rows: readonly ExportRow[]): ExportRow {
  for (const target of EXPORT_TARGETS) {
    for (const output of outputsFor[target]) {
      const taken = rows.some((row) => row.target === target && row.output === output);
      if (!taken) return { id: newRowId(), target, output };
    }
  }
  return { id: newRowId(), target: "variable", output: "ttf" };
}
