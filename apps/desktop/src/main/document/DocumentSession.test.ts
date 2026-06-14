import { describe, expect, it } from "vitest";
import type { DocumentFlushRequest } from "../../shared/ipc/contract";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { Window } from "../windows/Window";
import type { WorkspaceProcess } from "../workspace/WorkspaceProcess";
import { DocumentSession } from "./DocumentSession";

class TestWorkspace {
  savedPath: string | null = null;

  constructor(public state: WorkspaceDocumentState) {}

  async documentState(): Promise<WorkspaceDocumentState> {
    return this.state;
  }

  async saveDocumentAs(path: string): Promise<WorkspaceDocumentState> {
    this.savedPath = path;
    this.state = {
      ...this.state,
      sourceKind: "package",
      saveTarget: path,
      savedRevision: this.state.revision,
      dirty: false,
      needsSaveAs: false,
    };
    return this.state;
  }
}

class TestWindow {
  title = "";
  flushRequest: DocumentFlushRequest | null = null;

  readonly window = {
    webContents: {
      isDestroyed: () => false,
    },
  };

  setTitle(title: string): void {
    this.title = title;
  }
}

describe("main document save workflow", () => {
  it("keeps Save As behind the renderer flush barrier", async () => {
    const savePath = "/tmp/SavedFont.shift";
    const workspace = new TestWorkspace({
      documentId: "doc-1",
      sourceKind: "untitled",
      saveTarget: null,
      revision: 1,
      savedRevision: 0,
      dirty: true,
      needsSaveAs: true,
    });
    const window = new TestWindow();
    const session = new DocumentSession({
      workspace: workspace as unknown as WorkspaceProcess,
      activeWindow: () => window as unknown as Window,
      applicationName: () => "Shift Test",
      saveDialog: async () => savePath,
      sendFlushRequest: (_window, request) => {
        window.flushRequest = request;
      },
    });

    const save = session.saveAs();
    await Promise.resolve();
    await Promise.resolve();

    expect(window.flushRequest).toEqual({ requestId: "1" });
    expect(workspace.savedPath).toBeNull();

    session.completeFlush(window.flushRequest!);
    await save;

    expect(workspace.savedPath).toBe(savePath);
    expect(workspace.state.dirty).toBe(false);
    expect(workspace.state.savedRevision).toBe(1);
    expect(window.title).toBe("SavedFont.shift - Shift Test");
  });
});
