import { Editor } from "./lib/editor/Editor";
import { Font } from "./lib/model/Font";
import { FontStore } from "./lib/model/FontStore";
import { signal } from "./lib/signals";
import { Hand } from "./lib/tools/hand/Hand";
import { Pen } from "./lib/tools/pen/Pen";
import { Select } from "./lib/tools/select/Select";
import { ShapeTool } from "./lib/tools/shape/ShapeTool";
import type { ShapeKind } from "./lib/tools/shape/types";
import type { MemoryFontSession, MemoryFontSessionOptions } from "./types/fontSession";

const EmptyToolIcon = () => null;

/** Creates an empty workspace-free editor over a browser-owned font source. */
export function createMemoryFontSession({
  source,
  clipboard,
}: MemoryFontSessionOptions): MemoryFontSession {
  const store = new FontStore({ font: source.font, records: source.records });
  const font = new Font({ store, reader: source });
  const editor = new Editor({
    font,
    fontStore: store,
    clipboard,
    sessionMode: "memory",
  });

  const shapeKindCell = signal<ShapeKind>("rectangle", { name: "tool.Shape.kind" });
  const selectRectangle = () => shapeKindCell.set("rectangle");
  const selectEllipse = () => shapeKindCell.set("ellipse");

  editor.registerTool({
    id: "select",
    create: (toolEditor) => new Select(toolEditor),
    icon: EmptyToolIcon,
    tooltip: "Select Tool (V)",
    shortcut: "v",
  });
  editor.registerTool({
    id: "pen",
    create: (toolEditor) => new Pen(toolEditor),
    icon: EmptyToolIcon,
    tooltip: "Pen Tool (P)",
    shortcut: "p",
    disabled: true,
  });
  editor.registerTool({
    id: "hand",
    create: (toolEditor) => new Hand(toolEditor),
    icon: EmptyToolIcon,
    tooltip: "Hand Tool (H)",
    shortcut: "h",
  });
  editor.registerTool({
    id: "shape",
    create: (toolEditor) => new ShapeTool(toolEditor, shapeKindCell),
    icon: EmptyToolIcon,
    tooltip: "Rectangle Tool (R)",
    shortcut: "r",
    disabled: true,
    onSelect: selectRectangle,
    menuSelectionCell: shapeKindCell,
    menuItems: [
      {
        id: "rectangle",
        icon: EmptyToolIcon,
        label: "Rectangle",
        shortcut: "r",
        get selected() {
          return shapeKindCell.peek() === "rectangle";
        },
        onSelect: selectRectangle,
      },
      {
        id: "ellipse",
        icon: EmptyToolIcon,
        label: "Ellipse",
        shortcut: "o",
        get selected() {
          return shapeKindCell.peek() === "ellipse";
        },
        onSelect: selectEllipse,
      },
    ],
  });
  editor.setActiveTool("select");

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
