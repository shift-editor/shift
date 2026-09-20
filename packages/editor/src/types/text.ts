import type { RunId } from "@shift/types";

/** Stores document-scoped proof text content. */
export interface TextRunRecord {
  readonly id: RunId;
  readonly type: "textrun";
  readonly scope: "document";
  readonly text: string;
}
