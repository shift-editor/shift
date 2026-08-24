import type { GlyphInfo } from "@shift/glyph-info";
import type { GlyphId, GlyphSnapshot } from "@shift/types";
import { electronSystemClipboard } from "@/lib/clipboard";
import { AuthoredGlyphAtlasSource } from "@/lib/graphics/backends/AuthoredGlyphAtlasSource";
import { ImportedGlyphAtlasSource } from "@/lib/graphics/backends/ImportedGlyphAtlasSource";
import { Editor } from "@/lib/editor/Editor";
import { Font } from "@/lib/model/Font";
import { FontStore } from "@/lib/model/FontStore";
import { GlyphCatalog } from "@/lib/catalog/GlyphCatalog";
import { registerBuiltInTools } from "@/lib/tools/tools";
import type { GlyphReader } from "@/types/glyph";
import { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import { getShiftHost } from "@/host/shiftHost";
import { Workspace } from "./Workspace";
import { createAuthoredFontSession, createPreviewFontSession } from "./FontSession";
import type { FontSession } from "@/types/fontSession";
import { getGlyphInfo } from "./glyphInfo";

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
    case "authored": {
      const host = getShiftHost();
      const workspace = new Workspace({ host, client, clipboard: electronSystemClipboard });
      await workspace.connect();
      const atlas = new AuthoredGlyphAtlasSource(
        workspace.font.editCoordinator,
        () => workspace.font.getAxes(),
        () => workspace.font.getAxisMappingBases(),
      );
      const catalog = new GlyphCatalog(workspace.editor, glyphInfo, atlas);
      return createAuthoredFontSession(catalog, workspace, client);
    }
    case "preview": {
      await client.connect();
      const source = client.sourceCell.peek();
      if (!source) throw new Error("font source connected without a snapshot");

      const store = new FontStore({ font: source.font });
      const font = new Font({ store, reader: sourceGlyphReader(client) });
      const editor = new Editor({ font, fontStore: store, clipboard: electronSystemClipboard });
      registerBuiltInTools(editor);
      editor.setActiveTool("select");

      const catalog = new GlyphCatalog(editor, glyphInfo, new ImportedGlyphAtlasSource(client));
      return createPreviewFontSession(catalog, client, font, editor);
    }
  }
}

function sourceGlyphReader(client: FontSessionClient): GlyphReader {
  return {
    async read(glyphIds: readonly GlyphId[]) {
      const closures = await Promise.all(glyphIds.map((glyphId) => client.sourceGlyph(glyphId)));
      const snapshots = new Map<GlyphId, GlyphSnapshot>();
      for (const closure of closures) {
        for (const snapshot of closure) snapshots.set(snapshot.glyphId, snapshot);
      }
      return [...snapshots.values()];
    },
  };
}
