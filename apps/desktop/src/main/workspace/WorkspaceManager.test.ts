import { describe, expect, it } from "vitest";
import { FontSessionHost } from "./FontSessionHost";
import { WorkspaceManager } from "./WorkspaceManager";
import { WorkspaceProcess } from "./WorkspaceProcess";

function previewSession(workspaceId: string): FontSessionHost {
  return new FontSessionHost({
    mode: "preview",
    sessionId: workspaceId,
    workspaceProcess: new WorkspaceProcess(),
  });
}

describe("WorkspaceManager session ownership", () => {
  it("allows a workspace identity to be registered again only after unregister", () => {
    const manager = new WorkspaceManager({
      documentsRoot: () => "/tmp",
      applicationName: () => "Shift",
    });
    const first = previewSession("workspace_a");
    const second = previewSession("workspace_a");

    manager.register(first);
    expect(() => manager.register(second)).toThrow("Workspace session already registered");
    manager.unregister(first.workspaceId);
    manager.register(second);

    expect(manager.list()).toEqual([second]);
    manager.unregister(second.workspaceId);
  });
});
