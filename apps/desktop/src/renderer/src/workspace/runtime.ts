import { electronSystemClipboard } from "@/lib/clipboard";
import { PreviewGlyphCatalogSource } from "@/lib/catalog/PreviewGlyphCatalogSource";
import { ShiftGlyphCatalogSource } from "@/lib/catalog/ShiftGlyphCatalogSource";
import { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import { getShiftHost } from "@/host/shiftHost";
import { getGlyphInfo } from "./glyphInfo";
import { FontSession } from "./FontSession";
import { Workspace } from "./Workspace";

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
    await client.connect();

    switch (mode) {
      case "shift": {
        const workspace = new Workspace({
          host,
          client,
          clipboard: electronSystemClipboard,
        });
        await workspace.connect();
        const catalog = new ShiftGlyphCatalogSource(workspace.editor, getGlyphInfo());
        return new FontSession(mode, catalog, workspace, client);
      }
      case "preview": {
        const snapshot = client.sourceCell.peek();
        if (!snapshot) throw new Error("preview connected without a source snapshot");

        const catalog = new PreviewGlyphCatalogSource(snapshot.directory, client, getGlyphInfo());
        return new FontSession(mode, catalog, null, client);
      }
    }
  } catch (error) {
    client.dispose();
    globalThis.shiftFontSession = null;
    throw error;
  }
}
