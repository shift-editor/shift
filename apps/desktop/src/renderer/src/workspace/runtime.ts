import type { GlyphInfo } from "@shift/glyph-info";
import { electronSystemClipboard } from "@/lib/clipboard/electronSystemClipboard";
import { AuthoredGlyphAtlasSource } from "@/lib/graphics/backends/AuthoredGlyphAtlasSource";
import { ImportedGlyphAtlasSource } from "@/lib/graphics/backends/ImportedGlyphAtlasSource";
import { GlyphCatalog } from "@/lib/catalog/GlyphCatalog";
import { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import { getShiftHost } from "@/host/shiftHost";
import { Workspace } from "./Workspace";
import { createPreviewFontSession, createWorkspaceFontSession } from "./FontSession";
import type { FontSession } from "@/types/fontSession";
import { getGlyphInfo } from "./glyphInfo";
import { openPreviewFont } from "./PreviewFont";

declare global {
  var shiftFontSession: Promise<FontSession> | null;
}

/** Returns the one renderer session connected to the sender's main-owned font. */
export function getFontSession(): Promise<FontSession> {
  globalThis.shiftFontSession ??= connectFontSession();
  return globalThis.shiftFontSession;
}

async function connectFontSession(): Promise<FontSession> {
  const host = getShiftHost();
  const mode = await host.session.mode();
  const client = new FontSessionClient(host, { mode });

  try {
    return await createFontSession(client, getGlyphInfo());
  } catch (error) {
    client.dispose();
    globalThis.shiftFontSession = null;
    throw error;
  }
}

async function createFontSession(
  client: FontSessionClient,
  glyphInfo: GlyphInfo,
): Promise<FontSession> {
  switch (client.mode) {
    case "workspace": {
      const host = getShiftHost();
      const workspace = new Workspace({
        host,
        client,
        clipboard: electronSystemClipboard,
        glyphInfo,
      });
      await workspace.connect();
      const atlas = new AuthoredGlyphAtlasSource(
        workspace.editCoordinator,
        () => workspace.font.getAxes(),
        () => workspace.font.getAxisMappingBases(),
      );
      const catalog = new GlyphCatalog(workspace.editor, glyphInfo, atlas);
      return createWorkspaceFontSession(catalog, workspace, client);
    }
    case "preview": {
      const preview = await openPreviewFont({
        client,
        layers: getShiftHost().layers,
        glyphInfo,
        clipboard: electronSystemClipboard,
      });
      const atlas = new ImportedGlyphAtlasSource(client);
      const catalog = new GlyphCatalog(preview.editor, glyphInfo, atlas);
      return createPreviewFontSession(catalog, client, preview);
    }
  }
}
