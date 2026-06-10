/**
 * Filesystem allocation for one draft document.
 *
 * @remarks
 * Utility-process internal: store paths never cross to main or the renderer.
 */
export type DraftAllocation = {
  documentId: string;
  storePath: string;
};
