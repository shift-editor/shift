import type { AgentCallMap, DocumentOperation } from "@shared/agent/protocol";
import type { AgentRevisions } from "./AgentRevisions";
import type { ShiftHistory } from "./ShiftHistory";
import type { ShiftPages } from "./ShiftPages";

/** One document edit as the agent lane serves it. */
export type DocumentCall<K extends DocumentOperation> = (
  input: AgentCallMap[K]["request"],
) => Promise<AgentCallMap[K]["response"]>;

/** Every document edit, by its agent-lane name. */
export type DocumentCalls = { readonly [K in DocumentOperation]: DocumentCall<K> };

/**
 * The document edits an agent makes (`shift.pages` and `shift.history`), for
 * one window: its pages and its undo and redo, behind its font-revision guard.
 *
 * @remarks
 * Each call checks `ifFontRevision` before it changes anything. Page edits
 * are scene data, so they answer with the revision they were checked
 * against; an undo or redo of a font edit answers with the revision it moved
 * the font to.
 */
export class AgentDocument {
  /** The handlers the agent lane serves, by call name. */
  readonly calls: DocumentCalls;

  constructor(pages: ShiftPages, history: ShiftHistory, revisions: AgentRevisions) {
    this.calls = {
      "pages.create": ({ ifFontRevision, ...input }) =>
        revisions.write(ifFontRevision, async () => pages.create(input)),
      "pages.rename": ({ ifFontRevision, ...input }) =>
        revisions.write(ifFontRevision, async () => pages.rename(input)),
      "pages.delete": ({ ifFontRevision, ...input }) =>
        revisions.write(ifFontRevision, async () => pages.delete(input)),
      "history.undo": ({ ifFontRevision }) => revisions.write(ifFontRevision, () => history.undo()),
      "history.redo": ({ ifFontRevision }) => revisions.write(ifFontRevision, () => history.redo()),
    };
  }
}
