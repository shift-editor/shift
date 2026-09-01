import { describe, expect, it } from "vitest";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { NativeDialogs } from "../dialogs/NativeDialogs";
import type { ShiftLogger } from "../logging";
import type { Document } from "./DocumentClient";
import { DocumentSession } from "./DocumentSession";

const silentLogger: ShiftLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function documentState(dirty = true): WorkspaceDocumentState {
  return {
    workspaceId: "workspace",
    sourceKind: "shift",
    documentId: "document",
    saveTarget: "/tmp/document.shift",
    canonicalPath: "/tmp/document.shift",
    dirty,
    needsSaveAs: false,
  };
}

function nativeDialogs(confirmDirtyDocument: NativeDialogs["confirmDirtyDocument"]): NativeDialogs {
  return {
    async openFont() {
      return null;
    },
    async showCreateFailure() {},
    async showOpenFailure() {},
    async saveShiftDocument() {
      return null;
    },
    async exportTrueTypeFont() {
      return null;
    },
    confirmDirtyDocument,
    async confirmDocumentReopen() {
      return "close";
    },
    async showSaveFailure() {},
    async showExportFailure() {},
  };
}

describe("DocumentSession shared close transition", () => {
  it("shares one save decision and one workspace close", async () => {
    let dialogCount = 0;
    let saveCount = 0;
    let closeCount = 0;
    let workspaceOpen = true;
    let chooseSave!: () => void;
    let finishClose!: () => void;
    const choice = new Promise<void>((resolve) => (chooseSave = resolve));
    const closing = new Promise<void>((resolve) => (finishClose = resolve));
    const document: Document = {
      get connected() {
        return workspaceOpen;
      },
      async state() {
        if (!workspaceOpen) throw new Error("invalid workspace: no workspace is open");
        return documentState();
      },
      async save() {
        if (!workspaceOpen) throw new Error("invalid workspace: no workspace is open");
        saveCount++;
        return documentState(false);
      },
      async export() {
        throw new Error("unused");
      },
    };
    const session = new DocumentSession({
      document,
      closeDocument: async () => {
        closeCount++;
        await closing;
        workspaceOpen = false;
      },
      dialogWindow: () => null,
      windows: () => [],
      applicationName: () => "Shift",
      nativeDialogs: nativeDialogs(async (_window, _state, reason) => {
        dialogCount++;
        expect(reason).toBe("window");
        await choice;
        return "save";
      }),
      log: silentLogger,
    });

    const windowClose = session.prepareClose("window");
    const updateClose = session.prepareClose("update");
    chooseSave();
    await expect(Promise.all([windowClose, updateClose])).resolves.toEqual([true, true]);
    const firstCommit = session.commitClose();
    const secondCommit = session.commitClose();
    finishClose();
    await Promise.all([firstCommit, secondCommit]);

    expect({ dialogCount, saveCount, closeCount, workspaceOpen }).toEqual({
      dialogCount: 1,
      saveCount: 1,
      closeCount: 1,
      workspaceOpen: false,
    });
  });

  it("retains a discard decision after preparation settles", async () => {
    let dialogCount = 0;
    let closeCount = 0;
    const session = new DocumentSession({
      document: {
        connected: true,
        async state() {
          return documentState();
        },
        async save() {
          throw new Error("save must not run for discard");
        },
        async export() {
          throw new Error("unused");
        },
      },
      closeDocument: async (discard) => {
        expect(discard).toBe(true);
        closeCount++;
      },
      dialogWindow: () => null,
      windows: () => [],
      applicationName: () => "Shift",
      nativeDialogs: nativeDialogs(async () => {
        dialogCount++;
        return "discard";
      }),
      log: silentLogger,
    });

    await expect(session.prepareClose("window")).resolves.toBe(true);
    await expect(session.prepareClose("update")).resolves.toBe(true);
    await Promise.all([session.commitClose(), session.commitClose()]);

    expect({ dialogCount, closeCount }).toEqual({ dialogCount: 1, closeCount: 1 });
  });

  it("returns one cancel outcome to every requester and resets", async () => {
    let dialogCount = 0;
    let choice: "cancel" | "discard" = "cancel";
    const session = new DocumentSession({
      document: {
        connected: true,
        async state() {
          return documentState();
        },
        async save() {
          throw new Error("save must not run");
        },
        async export() {
          throw new Error("unused");
        },
      },
      closeDocument: async () => {},
      dialogWindow: () => null,
      windows: () => [],
      applicationName: () => "Shift",
      nativeDialogs: nativeDialogs(async () => {
        dialogCount++;
        return choice;
      }),
      log: silentLogger,
    });

    const windowClose = session.prepareClose("window");
    const updateClose = session.prepareClose("update");
    await expect(Promise.all([windowClose, updateClose])).resolves.toEqual([false, false]);
    choice = "discard";
    await expect(session.prepareClose("quit")).resolves.toBe(true);

    expect(dialogCount).toBe(2);
  });

  it("resets after preparation and workspace close failures", async () => {
    let dialogFails = true;
    let closeFails = true;
    let dialogCount = 0;
    const session = new DocumentSession({
      document: {
        connected: true,
        async state() {
          return documentState();
        },
        async save() {
          throw new Error("save must not run");
        },
        async export() {
          throw new Error("unused");
        },
      },
      closeDocument: () => {
        if (closeFails) throw new Error("close failed");
        return Promise.resolve();
      },
      dialogWindow: () => null,
      windows: () => [],
      applicationName: () => "Shift",
      nativeDialogs: nativeDialogs(async () => {
        dialogCount++;
        if (dialogFails) throw new Error("dialog failed");
        return "discard";
      }),
      log: silentLogger,
    });

    await expect(session.prepareClose("window")).rejects.toThrow("dialog failed");
    dialogFails = false;
    await expect(session.prepareClose("update")).resolves.toBe(true);
    await expect(session.commitClose()).rejects.toThrow("close failed");
    closeFails = false;
    await expect(session.prepareClose("quit")).resolves.toBe(true);
    await expect(session.commitClose()).resolves.toBeUndefined();

    expect(dialogCount).toBe(3);
  });
});
