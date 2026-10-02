import type { EditorView } from "@shift/runtime";

/** Main-to-renderer calls for live agent inspection of one explicit window. */
export type AgentCallMap = {
  "editor.inspect": { request: void; response: EditorView };
};

export type AgentEventMap = Record<string, never>;
