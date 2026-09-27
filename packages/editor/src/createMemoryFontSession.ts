import { Editor } from "./lib/editor/Editor";
import { Font } from "./lib/model/Font";
import { FontStore } from "./lib/model/FontStore";
import { Hand } from "./lib/tools/hand/Hand";
import { Select } from "./lib/tools/select/Select";
import type {
  MemoryFontSession,
  MemoryFontSessionOptions,
  MemoryToolName,
} from "./types/fontSession";

const EmptyToolIcon = () => null;

const DEFAULT_TOOLS: readonly MemoryToolName[] = ["select", "hand"];

/** Creates an empty workspace-free editor over a browser-owned font source. */
export function createMemoryFontSession({
  source,
  clipboard,
  tools = DEFAULT_TOOLS,
}: MemoryFontSessionOptions): MemoryFontSession {
  const store = new FontStore({ font: source.font, records: source.records });
  const font = new Font({ store, reader: source });
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
    },
  };
}
