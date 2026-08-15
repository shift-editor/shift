import type { FontIntent } from "@shift/types";

declare const WorkspaceEditIdBrand: unique symbol;

/** Renderer-local correlation identity; never crosses the workspace boundary. */
export type WorkspaceEditId = number & {
  readonly [WorkspaceEditIdBrand]: typeof WorkspaceEditIdBrand;
};

/** One renderer edit matching one workspace apply and one undo entry. */
export interface WorkspaceEdit {
  readonly id: WorkspaceEditId;
  readonly intents: FontIntent[];
  readonly label?: string;
}

/** Applies one accepted edit to renderer-local state before workspace I/O. */
export type PendingEditApplication = (editId: WorkspaceEditId) => void;

export type WorkspaceApplyStatus = "idle" | "queued" | "applying";
