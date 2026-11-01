import type { AgentCallMap, TextOperation } from "@shared/agent/protocol";
import type { AgentRevisions } from "./AgentRevisions";
import type { ShiftTextRuns } from "./ShiftTextRuns";

/** One proof-text call as the agent lane serves it. */
export type TextCall<K extends TextOperation> = (
  input: AgentCallMap[K]["request"],
) => Promise<AgentCallMap[K]["response"]>;

/** Every proof-text call, by its agent-lane name. */
export type TextCalls = { readonly [K in TextOperation]: TextCall<K> };

/**
 * The proof-text calls an agent makes (`shift.text`), for one window: the
 * window's text runs behind its font-revision guard.
 *
 * @remarks
 * Reads observe one revision; writes check `ifFontRevision` before changing
 * anything, and answer with a revision they leave as it was, since proof
 * text is not font data.
 */
export class AgentText {
  /** The handlers the agent lane serves, by call name. */
  readonly calls: TextCalls;

  constructor(text: ShiftTextRuns, revisions: AgentRevisions) {
    this.calls = {
      "text.runs": ({ ifFontRevision, ...input }) =>
        revisions.observe(ifFontRevision, () => text.runs(input)),
      "text.get": ({ ifFontRevision, ...input }) =>
        revisions.observe(ifFontRevision, () => text.get(input)),
      "text.create": ({ ifFontRevision, ...input }) =>
        revisions.write(ifFontRevision, () => text.create(input)),
      "text.setText": ({ ifFontRevision, ...input }) =>
        revisions.write(ifFontRevision, () => text.setText(input)),
      "text.setCaret": ({ ifFontRevision, ...input }) =>
        revisions.write(ifFontRevision, () => text.setCaret(input)),
      "text.delete": ({ ifFontRevision, ...input }) =>
        revisions.write(ifFontRevision, async () => text.delete(input)),
    };
  }
}
