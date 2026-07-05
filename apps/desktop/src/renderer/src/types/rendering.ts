/**
 * Names the editor paint phase requested from node definitions.
 *
 * @remarks
 * Render layers own pass ordering. Node definitions choose which phases they
 * paint in and ignore the rest.
 */
export type RenderPass = "background" | "content" | "controls" | "overlay";
