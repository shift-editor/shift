import HandIcon from "@/assets/toolbar/hand.svg";
import PenIcon from "@/assets/toolbar/pen.svg";
import SelectIcon from "@/assets/toolbar/select.svg";
import ShapeIcon from "@/assets/toolbar/shape.svg";
import TextIcon from "@/assets/toolbar/text.svg";
import RulerIcon from "@/assets/toolbar/ruler.svg";

import { Editor } from "@/lib/editor/Editor";

import { Hand } from "./hand";
import { Pen } from "./pen";
import { Select } from "./select";
import { Shape } from "./shape";
import TextTool from "./text/Text";
import { Ruler } from "./ruler/Ruler";

export function registerBuiltInTools(editor: Editor): void {
  editor.registerTool({
    id: "select",
    create: (api) => new Select(api),
    icon: SelectIcon,
    tooltip: "Select Tool (V)",
    shortcut: "v",
  });
  editor.registerTool({
    id: "pen",
    create: (api) => new Pen(api),
    icon: PenIcon,
    tooltip: "Pen Tool (P)",
    shortcut: "p",
  });
  editor.registerTool({
    id: "hand",
    create: (api) => new Hand(api),
    icon: HandIcon,
    tooltip: "Hand Tool (H)",
    shortcut: "h",
  });
  editor.registerTool({
    id: "shape",
    create: (api) => new Shape(api),
    icon: ShapeIcon,
    tooltip: "Shape Tool (S)",
    shortcut: "s",
  });
  editor.registerTool({
    id: "text",
    create: (api) => new TextTool(api),
    icon: TextIcon,
    tooltip: "Text Tool (T)",
    shortcut: "t",
  });
  editor.registerTool({
    id: "ruler",
    create: (api) => new Ruler(api),
    icon: RulerIcon,
    tooltip: "Ruler Tool (R)",
    shortcut: "r",
  });
}
