import { Editor } from "./lib/editor/Editor";
import { SessionEngine } from "./lib/engine/SessionEngine";
import { Font } from "./lib/model/Font";
import { FontStore } from "./lib/model/FontStore";
import { Hand } from "./lib/tools/hand/Hand";
import { Select } from "./lib/tools/select/Select";
import { loadEngine } from "./lib/wasm/engine";
import type { GlyphReader } from "./types/glyph";
import type {
  MemoryEditorOptions,
  MemoryFontSession,
  MemoryFontSessionOptions,
  MemoryFontSource,
  MemoryToolName,
  NewMemoryFont,
} from "./types/fontSession";

const EmptyToolIcon = () => null;

const DEFAULT_TOOLS: readonly MemoryToolName[] = ["select", "hand"];

/**
 * Opens a workspace-free editor over a font held in memory.
 *
 * @remarks
 * The font runs on its own engine, with every layer loaded: its records,
 * variation, kerning and text layout come from the engine, as an open
 * document's do. Nothing is persisted; edits are drafts the session shows.
 *
 * @throws When the engine module fails to load, or `source.font` does not
 * decode to a font.
 */
export async function createMemoryFontSession({
  source,
  ...options
}: MemoryFontSessionOptions): Promise<MemoryFontSession> {
  const engine = await SessionEngine.open({ kind: "resident", font: source.font });
  return memoryFontSession(engine, options);
}

/**
 * A workspace-free editor over `engine`'s font, which the session owns and
 * disposes with itself.
 */
export function memoryFontSession(
  engine: SessionEngine,
  { clipboard, tools = DEFAULT_TOOLS }: MemoryEditorOptions,
): MemoryFontSession {
  const store = new FontStore({
    workspace: { workspaceId: "memory", ...engine.fontHeader(), ...engine.fontRecords() },
    engine,
  });
  const font = new Font({ store, reader: residentGlyphReader(engine) });
  const editor = new Editor({
    font,
    fontStore: store,
    clipboard,
    sessionMode: "memory",
  });

  for (const tool of new Set(tools)) {
    if (tool === "select") {
      editor.registerTool({
        id: "select",
        create: (toolEditor) => new Select(toolEditor),
        icon: EmptyToolIcon,
        tooltip: "Select Tool (V)",
        shortcut: "v",
      });
    } else {
      editor.registerTool({
        id: "hand",
        create: (toolEditor) => new Hand(toolEditor),
        icon: EmptyToolIcon,
        tooltip: "Hand Tool (H)",
        shortcut: "h",
      });
    }
  }
  const [initialTool] = tools;
  if (initialTool) editor.setActiveTool(initialTool);

  let disposed = false;

  return {
    mode: "memory",
    font,
    editor,
    dispose() {
      if (disposed) return;
      disposed = true;
      editor.destroy();
      font.dispose();
      engine.dispose();
    },
  };
}

/**
 * A new font held in memory, with one source and no glyphs, for
 * {@link createMemoryFontSession} to open, as an untitled document starts.
 *
 * @throws When the engine module fails to load.
 */
export async function newMemoryFontSource({
  familyName,
  unitsPerEm,
}: NewMemoryFont): Promise<MemoryFontSource> {
  const { EngineSession } = await loadEngine();
  return { font: EngineSession.newFont(familyName, unitsPerEm) };
}

/**
 * Glyphs read from a resident engine, which holds every layer. A memory
 * session has no glyph catalog, so it previews nothing.
 */
function residentGlyphReader(engine: SessionEngine): GlyphReader {
  return {
    async read(glyphIds) {
      return engine.glyphSnapshots(glyphIds);
    },
    async glyphPreviews() {
      return [];
    },
  };
}
