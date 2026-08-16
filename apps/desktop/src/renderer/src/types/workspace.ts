import type { FontIntent } from "@shift/types";
import type { PendingEditId } from "./editing";

/** One renderer edit matching one workspace apply and one undo entry. */
export interface WorkspaceEdit {
  readonly id: PendingEditId;
  readonly intents: FontIntent[];
  readonly label?: string;
}

export type WorkspaceApplyStatus = "idle" | "queued" | "applying";
