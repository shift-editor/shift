import HandIcon from "@/assets/toolbar/hand.svg";
import PenIcon from "@/assets/toolbar/pen.svg";
import SelectIcon from "@/assets/toolbar/select.svg";
import ShapeIcon from "@/assets/toolbar/shape.svg";
import TextIcon from "@/assets/toolbar/text.svg";

import type { Editor } from "@/lib/editor/Editor";
import type { ToolManifest } from "./core";

import { Hand } from "./hand";
import { Pen } from "./pen";
import { Select } from "./select";
import { Shape } from "./shape";
import { TextTool } from "./text/Text";

export const BUILT_IN_TOOL_MANIFESTS: readonly ToolManifest[] = [
  {
    id: "select",
    create: (api) => new Select(api),
    icon: SelectIcon,
    tooltip: "Select Tool (V)",
    shortcut: "v",
  },
  {
    id: "pen",
    create: (api) => new Pen(api),
    icon: PenIcon,
    tooltip: "Pen Tool (P)",
    shortcut: "p",
  },
  {
    id: "hand",
    create: (api) => new Hand(api),
    icon: HandIcon,
    tooltip: "Hand Tool (H)",
    shortcut: "h",
  },
  {
    id: "shape",
    create: (api) => new Shape(api),
    icon: ShapeIcon,
    tooltip: "Shape Tool (S)",
    shortcut: "s",
  },
  {
    id: "text",
    create: (api) => new TextTool(api),
    icon: TextIcon,
    tooltip: "Text Tool (T)",
    shortcut: "t",
  },
];

export function registerBuiltInTools(editor: Editor): void {
  for (const manifest of BUILT_IN_TOOL_MANIFESTS) editor.registerTool(manifest);
}
