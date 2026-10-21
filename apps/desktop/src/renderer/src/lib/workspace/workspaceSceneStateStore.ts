import type { SceneStateStore } from "@shift/editor/types";
import type { FontSessionClient } from "./FontSessionClient";
import type { WorkspaceEditCoordinator } from "./WorkspaceEditCoordinator";

/**
 * Keeps the editor's canvas in the open workspace document.
 *
 * @remarks
 * Reads the canvas that came with the workspace snapshot, and writes through
 * the edit coordinator's queue, so a save issued after a write includes it.
 *
 * @param client - Session whose latest workspace snapshot carries the stored canvas.
 * @param edits - Ordered workspace lane that writes the canvas.
 */
export function workspaceSceneStateStore(
  client: FontSessionClient,
  edits: WorkspaceEditCoordinator,
): SceneStateStore {
  return {
    async read() {
      return client.workspaceCell.peek()?.sceneState ?? null;
    },
    async write(state) {
      await edits.setSceneState(state);
    },
  };
}
