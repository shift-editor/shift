import type { GlyphInfo } from "@shift/glyph-info";
import type { GlyphId, GlyphSnapshot } from "@shift/types";
import type { SystemClipboard } from "@shift/editor/clipboard";
import { Editor } from "@shift/editor";
import { Font, FontStore, loadEngine, SessionEngine } from "@shift/editor/model";
import { locationFromDesignAxisLocation } from "@shift/editor/variation";
import type { GlyphReader } from "@shift/editor/types";
import type { LayerReaderHost } from "@shared/host/ShiftHost";
import { isConvertiblePreviewPath } from "@shared/workspace/previewConversion";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import { registerBuiltInTools } from "@/lib/tools/tools";

/** A preview window's font and read-only editor, and what they hold open. */
export interface PreviewFont {
  readonly font: Font;
  readonly editor: Editor;
  /** Disposes the font and closes what it reads through; the client stays connected. */
  dispose(): void;
}

/** What a preview's font opens with. */
export interface PreviewFontOptions {
  /** The connected preview's utility client: its source's path, glyph previews and atlas. */
  readonly client: FontSessionClient;
  /** The preload's readers, which open the previewed file glyph by glyph. */
  readonly layers: LayerReaderHost;
  readonly glyphInfo: GlyphInfo;
  readonly clipboard: SystemClipboard;
}

/**
 * Opens the font of the preview `client` is connected to, read-only.
 *
 * @remarks
 * A UFO, designspace or Glyphs file runs on an engine, as an open document
 * does: the engine opens over the preload's reader of the file, and the
 * font's records, glyphs, kerning and text layout come from it, so proof text
 * shapes with the font's own feature code. Nothing is imported or written.
 * A compiled font (TrueType, OpenType) has no engine yet: its glyphs come
 * from the utility, and its text lays out as typed.
 *
 * @throws When the client has no source, or the file cannot be read.
 */
export async function openPreviewFont(options: PreviewFontOptions): Promise<PreviewFont> {
  const { client } = options;
  // Text lays out in the engine module, with or without an engine session:
  // load it before anything asks for a layout, so the open glyph's run lays
  // out at once.
  await Promise.all([client.connect(), loadEngine()]);
  const source = client.sourceCell.peek();
  if (!source) throw new Error("font source connected without a snapshot");

  if (!isConvertiblePreviewPath(source.canonicalPath)) {
    return previewFont(
      new FontStore({ font: source.font }),
      options,
      utilityGlyphReader(client),
      () => {},
    );
  }

  const { layers } = options;
  const reader = layers.openSource(source.canonicalPath);
  let engine: SessionEngine;
  try {
    engine = await SessionEngine.open({
      kind: "reader",
      directory: layers.sourceDirectory(reader),
      request: (method, numbers, blobs) => layers.request(reader, method, numbers, blobs),
    });
  } catch (error) {
    layers.close(reader);
    throw error;
  }

  const store = new FontStore({
    workspace: {
      workspaceId: source.canonicalPath,
      ...engine.fontHeader(),
      ...engine.fontRecords(),
    },
    engine,
  });
  return previewFont(store, options, engineGlyphReader(engine, client), () => {
    engine.dispose();
    layers.close(reader);
  });
}

function previewFont(
  store: FontStore,
  { glyphInfo, clipboard }: PreviewFontOptions,
  reader: GlyphReader,
  close: () => void,
): PreviewFont {
  const font = new Font({ store, glyphInfo, reader });
  const editor = new Editor({ font, fontStore: store, clipboard, sessionMode: "preview" });
  registerBuiltInTools(editor);
  editor.setActiveTool("select");
  return {
    font,
    editor,
    dispose() {
      font.dispose();
      close();
    },
  };
}

/** Glyphs read from the preview's engine, which loads them from the file. */
function engineGlyphReader(engine: SessionEngine, client: FontSessionClient): GlyphReader {
  return {
    async read(glyphIds: readonly GlyphId[]) {
      return engine.glyphSnapshots(glyphIds);
    },
    glyphPreviews(glyphIds, location) {
      return client.glyphPreviews(glyphIds, locationFromDesignAxisLocation(location));
    },
  };
}

/** Glyphs of a compiled font, projected by the utility, each with its component closure. */
function utilityGlyphReader(client: FontSessionClient): GlyphReader {
  return {
    async read(glyphIds: readonly GlyphId[]) {
      const closures = await Promise.all(glyphIds.map((glyphId) => client.sourceGlyph(glyphId)));
      const snapshots = new Map<GlyphId, GlyphSnapshot>();
      for (const closure of closures) {
        for (const snapshot of closure) snapshots.set(snapshot.glyphId, snapshot);
      }
      return [...snapshots.values()];
    },
    glyphPreviews(glyphIds, location) {
      return client.glyphPreviews(glyphIds, locationFromDesignAxisLocation(location));
    },
  };
}
