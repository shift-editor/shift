import HandIcon from "@/assets/toolbar/hand.svg";
import PenIcon from "@/assets/toolbar/pen.svg";
import SelectIcon from "@/assets/toolbar/select.svg";
import ShapeIcon from "@/assets/toolbar/shape.svg";
import TextIcon from "@/assets/toolbar/text.svg";

import { Editor } from "@/lib/editor/Editor";

import { Hand } from "./hand";
import { Pen } from "./pen";
import { Select } from "./select";
import { Shape } from "./shape";
import TextTool from "./text/Text";

export function registerBuiltInTools(editor: Editor): void {
  editor.registerTool({
    id: "select",
    ToolClass: Select,
    icon: SelectIcon,
    tooltip: "Select Tool (V)",
    shortcut: "v",
  });
  editor.registerTool({
    id: "pen",
    ToolClass: Pen,
    icon: PenIcon,
    tooltip: "Pen Tool (P)",
    shortcut: "p",
  });
  editor.registerTool({
    id: "hand",
    ToolClass: Hand,
    icon: HandIcon,
    tooltip: "Hand Tool (H)",
    shortcut: "h",
  });
  editor.registerTool({
    id: "shape",
    ToolClass: Shape,
    icon: ShapeIcon,
    tooltip: "Shape Tool (S)",
    shortcut: "s",
  });
  editor.registerTool({
    id: "text",
    ToolClass: TextTool,
    icon: TextIcon,
    tooltip: "Text Tool (T)",
    shortcut: "t",
  });
}
