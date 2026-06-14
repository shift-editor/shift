import { describe, expect, it } from "vitest";
import type { DocumentSaveRequest } from "../../shared/ipc/contract";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { Window } from "../windows/Window";
import type { WorkspaceProcess } from "../workspace/WorkspaceProcess";
import { DocumentSession } from "./DocumentSession";

class TestWorkspace {
  constructor(public state: WorkspaceDocumentState | null) {}

  async documentState(): Promise<WorkspaceDocumentState | null> {
    return this.state;
  }
}

class TestWindow {
  title = "";
  saveRequest: DocumentSaveRequest | null = null;

  readonly window = {
    webContents: {
      isDestroyed: () => false,
    },
  };

  setTitle(title: string): void {
    this.title = title;
  }
}

const openState = (overrides: Partial<WorkspaceDocumentState> = {}): WorkspaceDocumentState => ({
  documentId: "doc-1",
  sourceKind: "package",
  saveTarget: "/tmp/Existing.shift",
  dirty: true,
  needsSaveAs: false,
  ...overrides,
});

describe("main document save workflow", () => {
  it("escalates an untitled document to Save As and issues the chosen path", async () => {
    const savePath = "/tmp/SavedFont.shift";
    const workspace = new TestWorkspace(
      openState({ sourceKind: "untitled", saveTarget: null, needsSaveAs: true }),
    );
    const window = new TestWindow();
    const session = new DocumentSession({
      workspace: workspace as unknown as WorkspaceProcess,
      activeWindow: () => window as unknown as Window,
      applicationName: () => "Shift Test",
      saveDialog: async () => savePath,
      sendSave: (_window, request) => {
        window.saveRequest = request;
      },
    });

    await session.save();

    expect(window.saveRequest).toEqual({ path: savePath });
  });

  it("issues a current-target save when the document already has a path", async () => {
    const workspace = new TestWorkspace(openState());
    const window = new TestWindow();
    const session = new DocumentSession({
      workspace: workspace as unknown as WorkspaceProcess,
      activeWindow: () => window as unknown as Window,
      applicationName: () => "Shift Test",
      sendSave: (_window, request) => {
        window.saveRequest = request;
      },
    });

    await session.save();

    expect(window.saveRequest).toEqual({ path: null });
    expect(window.title).toBe("Existing.shift * - Shift Test");
  });

  it("Save As always issues the path the dialog returns", async () => {
    const savePath = "/tmp/Renamed.shift";
    const workspace = new TestWorkspace(openState());
    const window = new TestWindow();
    const session = new DocumentSession({
      workspace: workspace as unknown as WorkspaceProcess,
      activeWindow: () => window as unknown as Window,
      applicationName: () => "Shift Test",
      saveDialog: async () => savePath,
      sendSave: (_window, request) => {
        window.saveRequest = request;
      },
    });

    await session.saveAs();

    expect(window.saveRequest).toEqual({ path: savePath });
  });

  it("issues nothing when the Save As dialog is cancelled", async () => {
    const workspace = new TestWorkspace(openState({ needsSaveAs: true }));
    const window = new TestWindow();
    const session = new DocumentSession({
      workspace: workspace as unknown as WorkspaceProcess,
      activeWindow: () => window as unknown as Window,
      applicationName: () => "Shift Test",
      saveDialog: async () => null,
      sendSave: (_window, request) => {
        window.saveRequest = request;
      },
    });

    await session.save();

    expect(window.saveRequest).toBeNull();
  });

  it("issues nothing when no document is open", async () => {
    const workspace = new TestWorkspace(null);
    const window = new TestWindow();
    const session = new DocumentSession({
      workspace: workspace as unknown as WorkspaceProcess,
      activeWindow: () => window as unknown as Window,
      applicationName: () => "Shift Test",
      sendSave: (_window, request) => {
        window.saveRequest = request;
      },
    });

    await session.save();

    expect(window.saveRequest).toBeNull();
  });
});
