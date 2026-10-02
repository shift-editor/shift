import type { EditorInspection, ShiftSession } from "@shift/runtime";

export type SandboxCallMap = {
  "sandbox.execute": {
    request: { code: string };
    response: unknown;
  };
};

export type SandboxEventMap = {
  "sandbox.ready": null;
};

export type SandboxHostCallMap = {
  "shift.sessions.list": {
    request: undefined;
    response: ShiftSession[];
  };
  "shift.editor.inspect": {
    request: { windowId: number };
    response: EditorInspection;
  };
};

export type SandboxHostEventMap = Record<string, never>;
