import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { ShiftLogger } from "../logging";
import type { Document } from "./DocumentClient";
import { DocumentSession } from "./DocumentSession";

vi.mock("electron", () => ({
  dialog: {
    showMessageBox: async () => ({ response: 1 }),
  },
}));

const cleanState: WorkspaceDocumentState = {
  documentId: "document-1",
  sourceKind: "package",
  saveTarget: "/tmp/Test.shift",
  packageId: "package-1",
  canonicalPath: "/tmp/Test.shift",
  dirty: false,
  needsSaveAs: false,
};

function createSession(state: WorkspaceDocumentState) {
  const result = { closedWith: null as boolean | null };
  const document: Document = {
    connected: true,
    state: async () => state,
    save: async () => ({ ...state, dirty: false }),
    export: async () => ({ path: "/tmp/Test.ttf", format: "ttf" }),
  };
  const log = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as ShiftLogger;
  const session = new DocumentSession({
    document,
    closeDocument: async (discard) => {
      result.closedWith = discard;
    },
    dialogWindow: () => null,
    windows: () => [],
    applicationName: () => "Shift",
    log,
  });
  return { session, result };
}

describe("DocumentSession exit confirmation", () => {
  it("defers clean workspace cleanup until exit is committed", async () => {
    const { session, result } = createSession(cleanState);

    expect(await session.confirmClose("update")).toBe(true);
    expect(result.closedWith).toBeNull();
    await session.commitExit();
    expect(result.closedWith).toBe(false);
  });

  it("keeps discarded changes recoverable if an update exit fails", async () => {
    const { session, result } = createSession({ ...cleanState, dirty: true });

    expect(await session.confirmClose("update")).toBe(true);
    session.cancelExit();
    await session.commitExit();
    expect(result.closedWith).toBeNull();
  });

  it("discards changes after update exit is committed", async () => {
    const { session, result } = createSession({ ...cleanState, dirty: true });

    expect(await session.confirmClose("update")).toBe(true);
    await session.commitExit();
    expect(result.closedWith).toBe(true);
  });

  it("still closes a discarded document for a window close", async () => {
    const { session, result } = createSession({ ...cleanState, dirty: true });

    expect(await session.confirmClose("window")).toBe(true);
    expect(result.closedWith).toBe(true);
  });
});
