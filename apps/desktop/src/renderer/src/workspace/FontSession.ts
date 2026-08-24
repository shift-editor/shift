import type { Editor } from "@/lib/editor/Editor";
import type { Font } from "@/lib/model/Font";
import type { GlyphCatalog } from "@/lib/catalog/GlyphCatalog";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import type { AuthoredFontSession, PreviewFontSession } from "@/types/fontSession";
import type { Workspace } from "./Workspace";

/**
 * Creates an authored renderer composition with durable workspace capabilities.
 *
 * @param catalog - Resident catalog owned for the session lifetime.
 * @param workspace - Connected authored workspace disposed with the session.
 * @param client - Session transport disposed after the renderer composition.
 * @returns an authored session whose disposal releases every owned resource.
 */
export function createAuthoredFontSession(
  catalog: GlyphCatalog,
  workspace: Workspace,
  client: FontSessionClient,
): AuthoredFontSession {
  return {
    mode: "authored",
    catalog,
    workspace,
    font: workspace.font,
    editor: workspace.editor,
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
 * @param font - Imported font model disposed with the session.
 * @param editor - Read-only editor sharing the imported font model.
 * @returns a preview session whose disposal releases every owned resource.
 */
export function createPreviewFontSession(
  catalog: GlyphCatalog,
  client: FontSessionClient,
  font: Font,
  editor: Editor,
): PreviewFontSession {
  return {
    mode: "preview",
    catalog,
    workspace: null,
    font,
    editor,
    dispose() {
      catalog.dispose();
      font.dispose();
      client.dispose();
    },
  };
}
