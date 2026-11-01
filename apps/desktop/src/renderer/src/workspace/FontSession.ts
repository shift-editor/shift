import { isConvertiblePreviewPath } from "@shared/workspace/previewConversion";
import type { GlyphCatalog } from "@/lib/catalog/GlyphCatalog";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import type { PreviewFontSession, WorkspaceFontSession } from "@/types/fontSession";
import type { Workspace } from "./Workspace";
import type { PreviewFont } from "./PreviewFont";
import { WindowTabs } from "@/lib/tabs/WindowTabs";
import { PageRenameGesture } from "@/lib/pages/PageRenameGesture";

/**
 * Creates a renderer composition with durable workspace capabilities.
 *
 * @param catalog - Resident catalog owned for the session lifetime.
 * @param workspace - Connected authored workspace disposed with the session.
 * @param client - Session transport disposed after the renderer composition.
 * @returns a workspace session whose disposal releases every owned resource.
 */
export function createWorkspaceFontSession(
  catalog: GlyphCatalog,
  workspace: Workspace,
  client: FontSessionClient,
): WorkspaceFontSession {
  return {
    mode: "workspace",
    catalog,
    workspace,
    font: workspace.font,
    editor: workspace.editor,
    tabs: workspace.tabs,
    pageRename: new PageRenameGesture(),
    dispose() {
      catalog.dispose();
      workspace.dispose();
      client.dispose();
    },
  };
}

/**
 * Creates a read-only renderer composition over an imported font source.
 *
 * @param catalog - Resident catalog owned for the session lifetime.
 * @param client - Session transport disposed after the renderer composition.
 * @param preview - The previewed font and its read-only editor, disposed with the session.
 * @returns a preview session whose disposal releases every owned resource.
 */
export function createPreviewFontSession(
  catalog: GlyphCatalog,
  client: FontSessionClient,
  preview: PreviewFont,
): PreviewFontSession {
  const { font, editor } = preview;
  return {
    mode: "preview",
    canConvert: isConvertiblePreviewPath(client.sourceCell.peek()?.canonicalPath ?? ""),
    catalog,
    workspace: null,
    font,
    editor,
    tabs: new WindowTabs(editor),
    pageRename: new PageRenameGesture(),
    dispose() {
      catalog.dispose();
      preview.dispose();
      client.dispose();
    },
  };
}
